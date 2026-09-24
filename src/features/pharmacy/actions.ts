"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionState } from "@/types/hospital";
import { validateMedicineImportRows } from "./import-schema";
import { rupeesToPaise } from "@/lib/domain/money";
import { databaseIdSchema } from "@/lib/validation/database-id";

const lineSchema = z
  .array(
    z.object({
      prescription_item_id: databaseIdSchema,
      batch_id: databaseIdSchema,
      quantity: z.number().int().positive(),
    }).strict(),
  )
  .min(1)
  // One prescription item may split across several physical batches.
  .max(200);
const schema = z.object({
  prescriptionId: databaseIdSchema,
  lines: z.string(),
  paymentMode: z.enum(["cash", "upi", "card", "bank_transfer", "other"]),
  idempotencyKey: databaseIdSchema,
  /** Consultation fee taken at the counter; the doctor set the amount. */
  consultationCollected: z.string().optional(),
});
export async function dispensePrescription(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requirePermission("dispense");
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  let lines: z.infer<typeof lineSchema>;
  try {
    lines = lineSchema.parse(JSON.parse(parsed.data.lines));
  } catch {
    return {
      ok: false,
      message: "Select a valid batch and quantity for at least one item.",
    };
  }
  const rawFee = parsed.data.consultationCollected?.trim() ?? "";
  let collectedPaise = 0;
  try {
    collectedPaise = rawFee === "" ? 0 : rupeesToPaise(rawFee);
  } catch (error) {
    return {
      ok: false,
      message: (error as Error).message,
    };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("dispense_prescription", {
    p_prescription_id: parsed.data.prescriptionId,
    p_lines: lines,
    p_payment_mode: parsed.data.paymentMode,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_consultation_collected_paise: collectedPaise,
  });
  if (error)
    return {
      ok: false,
      message: error.message.includes("expired or unavailable")
        ? "This prescription has expired or is no longer available. No stock was changed."
        : error.message.includes("stock unavailable")
          ? "Selected batch does not have enough unexpired stock."
          : error.message.includes("prescription item not found")
            ? "A prescribed medicine is no longer on this prescription. Refresh and try again."
          : error.message.includes("prescribed quantity cannot be changed")
            ? "Dispensing must use the quantity prescribed by the consultant."
            : error.message.includes("exact outstanding consultation fee")
              ? "The consultation collection must match the current outstanding fee. Refresh and try again."
          : error.message.includes("exceeds outstanding balance")
            ? "That is more than the outstanding consultation fee. Nothing was dispensed or collected."
            : "Dispensing failed; no stock was changed.",
    };
  const [{ data: prescription }, { data: sale }] = await Promise.all([
    supabase.from("prescriptions").select("status").eq("id", parsed.data.prescriptionId).single(),
    // The RPC computed this from the actual pack prices; re-deriving it here
    // from batch prices in JS would drift from the rounding it already did.
    supabase.from("pharmacy_sales").select("total_paise").eq("id", data).single(),
  ]);
  const prescriptionStatus = prescription?.status ?? "partially_dispensed";
  revalidatePath("/pharmacy");
  revalidatePath("/pharmacy/stock");
  revalidatePath("/pharmacy/sales");
  revalidatePath("/drug-stock");
  revalidatePath("/dashboard");
  return {
    ok: true,
    message:
      prescriptionStatus === "dispensed"
        ? "Prescription completed and exact batch stock updated."
        : "Selected quantities dispensed; the remaining quantities are still pending.",
    data: {
      saleId: String(data),
      prescriptionStatus,
      medicinesPaise: Number(sale?.total_paise ?? 0),
      consultationPaise: collectedPaise,
    },
  };
}

const unavailableSchema = z.object({
  prescriptionId: databaseIdSchema,
  unavailableIdempotencyKey: databaseIdSchema,
});

/**
 * Closes the still-pending quantity as unavailable without creating a sale,
 * collecting money, or touching stock. The remaining lines stay intact so
 * the outside-purchase prescription can print exactly what was not supplied.
 */
export async function markPrescriptionUnavailable(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requirePermission("dispense");
  const parsed = unavailableSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("mark_prescription_unavailable", {
    p_prescription_id: parsed.data.prescriptionId,
    p_idempotency_key: parsed.data.unavailableIdempotencyKey,
  });
  if (error)
    return {
      ok: false,
      message: error.message.includes("no remaining quantity")
        ? "Every prescribed item has already been dispensed."
        : error.message.includes("prescription unavailable")
          ? "This prescription is no longer pending. Refresh and try again."
          : "The unavailable outcome could not be recorded. No stock or payment was changed.",
    };

  revalidatePath("/pharmacy");
  revalidatePath("/dashboard");
  return {
    ok: true,
    message: "Remaining medicines marked unavailable. No sale, payment, or stock movement was recorded.",
    data: { prescriptionStatus: "unavailable" },
  };
}

const importSchema = z.object({
  fileName: z.string().min(1).max(255),
  rows: z.string(),
  idempotencyKey: databaseIdSchema,
});
export async function importMedicines(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requirePermission("manageMedicine");
  const parsed = importSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return { ok: false, message: "Import payload is invalid." };
  let source: unknown[];
  try {
    source = JSON.parse(parsed.data.rows);
  } catch {
    return { ok: false, message: "Import rows could not be read." };
  }
  const checked = validateMedicineImportRows(source);
  if (checked.invalid.length || checked.valid.length === 0)
    return {
      ok: false,
      message: "Resolve all validation errors before importing.",
    };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("bulk_import_medicines", {
    p_rows: checked.valid,
    p_file_name: parsed.data.fileName,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error)
    return {
      ok: false,
      message: "The transaction failed; no import rows were committed.",
    };
  revalidatePath("/pharmacy/stock");
  revalidatePath("/pharmacy/medicines");
  revalidatePath("/dashboard");
  const result = data as Record<string, number>;
  return {
    ok: true,
    message: `Imported ${result.success_count} rows: ${result.created_medicines} medicines, ${result.new_batches} new batches, ${result.updated_batches} updated batches.`,
    data: { ...result },
  };
}

const medicineSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  brandName: z.string().trim().min(2).max(200),
  genericName: z.string().trim().max(200).optional(),
  strength: z.string().trim().max(100).optional(),
  dosageForm: z.string().trim().min(2).max(100),
  manufacturer: z.string().trim().max(200).optional(),
  active: z.string().optional(),
});
export async function saveMedicine(_: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("manageMedicine");
  const parsed = medicineSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createSupabaseServerClient();
  const values = { brand_name: parsed.data.brandName, generic_name: parsed.data.genericName || null, strength: parsed.data.strength || null, dosage_form: parsed.data.dosageForm, manufacturer: parsed.data.manufacturer || null, active: parsed.data.active === "on", source: "hospital" };
  const query = parsed.data.id ? supabase.from("medicine_directory").update(values).eq("id", parsed.data.id) : supabase.from("medicine_directory").insert(values);
  const { error } = await query;
  if (error) return { ok: false, message: error.code === "23505" ? "This medicine already exists." : "Medicine could not be saved." };
  revalidatePath("/pharmacy/medicines");
  return { ok: true, message: "Medicine saved." };
}

/**
 * Takes a medicine out of the library.
 *
 * The RPC decides between a real delete and an archive, because only the
 * database can see whether a prescription, sale, ward request or ledger row
 * still points at it -- and none of those may change. Admin only, matching
 * the RPC's own guard.
 */
export async function deleteMedicine(_: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("manageUsers");
  const parsed = z.object({ id: databaseIdSchema }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Invalid removal request." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("delete_medicine", {
    p_medicine_id: parsed.data.id,
  });
  if (error)
    return {
      ok: false,
      message: error.message.includes("medicine not found")
        ? "This medicine is no longer in the library. Refresh and try again."
        : "This medicine could not be removed.",
    };
  const result = (data ?? {}) as { mode?: string; stock_units_held?: number };
  revalidateMedicineViews();
  return {
    ok: true,
    message:
      result.mode === "deleted"
        ? "Medicine deleted. It was never used, so nothing was left behind."
        : `Medicine removed from the library.${
            result.stock_units_held
              ? ` ${result.stock_units_held} unit(s) of counted stock were kept.`
              : ""
          } Past prescriptions and bills are unchanged.`,
  };
}

/** Puts an archived medicine back in the library. Batches stay inactive. */
export async function restoreMedicine(_: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("manageUsers");
  const parsed = z.object({ id: databaseIdSchema }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Invalid restore request." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("restore_medicine", {
    p_medicine_id: parsed.data.id,
  });
  if (error)
    return {
      ok: false,
      message: error.message.includes("medicine not found")
        ? "This medicine is already in the library. Refresh and try again."
        : "This medicine could not be restored.",
    };
  revalidateMedicineViews();
  return {
    ok: true,
    message:
      "Medicine restored. Re-activate its batches under Stock & Batches to sell it again.",
  };
}

/** Every surface that reads the directory or the stock counters built on it. */
function revalidateMedicineViews() {
  revalidatePath("/pharmacy/medicines");
  revalidatePath("/pharmacy/stock");
  revalidatePath("/drug-stock");
  revalidatePath("/dashboard");
}

const batchSchema = z.object({
  batchId: databaseIdSchema.optional().or(z.literal("")), medicineId: databaseIdSchema, batchNumber: z.string().trim().min(1).max(100), expiryDate: z.string().date(), quantityDelta: z.coerce.number().int(), purchasePrice: z.string(), sellingPrice: z.string(), lowStockThreshold: z.coerce.number().int().nonnegative(), unitsPerPack: z.coerce.number().int().min(1).max(10_000).default(1), active: z.string().optional(), reason: z.string().trim().min(2).max(200), idempotencyKey: databaseIdSchema,
});
export async function saveMedicineBatch(_: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("manageMedicine");
  const parsed = batchSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  // Both prices are per PACK; the piece price is derived from units_per_pack.
  let purchase: number, selling: number;
  try { purchase = rupeesToPaise(parsed.data.purchasePrice || "0"); selling = rupeesToPaise(parsed.data.sellingPrice); } catch (error) { return { ok: false, message: (error as Error).message }; }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("save_medicine_batch", { p_batch_id: parsed.data.batchId || null, p_medicine_id: parsed.data.medicineId, p_batch_number: parsed.data.batchNumber, p_expiry_date: parsed.data.expiryDate, p_quantity_delta: parsed.data.quantityDelta, p_purchase_price_paise: purchase, p_selling_price_paise: selling, p_low_stock_threshold: parsed.data.lowStockThreshold, p_active: parsed.data.active === "on", p_reason: parsed.data.reason, p_idempotency_key: parsed.data.idempotencyKey, p_units_per_pack: parsed.data.unitsPerPack });
  if (error) return { ok: false, message: error.message.includes("negative") ? "This adjustment would make stock negative." : error.message.includes("duplicate") ? "This batch already exists." : "Batch and stock could not be saved." };
  revalidatePath("/pharmacy"); revalidatePath("/pharmacy/stock"); revalidatePath("/pharmacy/medicines"); revalidatePath("/dashboard");
  return { ok: true, message: "Batch and stock saved." };
}
