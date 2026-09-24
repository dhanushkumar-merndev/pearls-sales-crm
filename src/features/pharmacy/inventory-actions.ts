"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { rupeesToPaise } from "@/lib/domain/money";
import { databaseIdSchema } from "@/lib/validation/database-id";
import type { ActionState } from "@/types/hospital";

const itemSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Item name is required.").max(150),
  unit: z.string().trim().max(30).optional(),
  price: z.string().trim(),
  quantity: z.string().trim(),
  lowStockThreshold: z.string().trim().optional(),
  expiryDate: z.string().optional(),
  active: z.string().optional(),
  reason: z.string().trim().min(2, "Give a reason for this stock change.").max(200),
  idempotencyKey: databaseIdSchema,
});

export async function saveInventoryItem(_: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("manageMedicine");
  const parsed = itemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };

  let pricePaise: number;
  try { pricePaise = rupeesToPaise(parsed.data.price || "0"); }
  catch (error) { return { ok: false, fieldErrors: { price: [(error as Error).message] } }; }
  const quantity = Number(parsed.data.quantity);
  if (!Number.isInteger(quantity) || quantity < 0)
    return { ok: false, fieldErrors: { quantity: ["Quantity must be a whole number of 0 or more."] } };
  const threshold = Number(parsed.data.lowStockThreshold || "0");

  const supabase = await createSupabaseServerClient();
  const id = parsed.data.id ? databaseIdSchema.safeParse(parsed.data.id) : null;
  if (parsed.data.id && !id?.success)
    return { ok: false, fieldErrors: { id: ["Invalid inventory item."] } };
  const { error } = await supabase.rpc("save_inventory_item", {
    p_item_id: id?.success ? id.data : null,
    p_name: parsed.data.name,
    p_unit: parsed.data.unit || null,
    p_selling_price_paise: pricePaise,
    p_quantity: quantity,
    p_low_stock_threshold: Number.isFinite(threshold) && threshold >= 0 ? Math.floor(threshold) : 0,
    p_expiry_date: parsed.data.expiryDate || null,
    p_active: parsed.data.active === "on",
    p_reason: parsed.data.reason,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error?.code === "23505")
    return { ok: false, fieldErrors: { name: ["An inventory item with this name already exists."] } };
  if (error?.message.includes("stock change reason"))
    return { ok: false, fieldErrors: { reason: ["Give a reason for this stock change."] } };
  if (error) return { ok: false, message: "Inventory item could not be saved." };
  revalidatePath("/pharmacy/inventory");
  revalidatePath("/pharmacy");
  revalidatePath("/dashboard");
  return { ok: true, message: "Inventory item saved." };
}

const saleSchema = z.object({
  patientId: databaseIdSchema,
  doctorId: z.string().optional(),
  procedureName: z.string().trim().min(2, "Procedure name is required.").max(150),
  procedureFee: z.string().trim().optional(),
  lines: z.string(),
  paymentMode: z.enum(["cash", "upi", "card", "bank_transfer", "other"]),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: databaseIdSchema,
});
const lineSchema = z
  .array(z.object({ inventory_item_id: databaseIdSchema, quantity: z.number().int().positive() }))
  .max(40);

export async function createProcedureSale(_: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("dispense");
  const parsed = saleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };

  let lines: z.infer<typeof lineSchema>;
  try { lines = lineSchema.parse(JSON.parse(parsed.data.lines)); }
  catch { return { ok: false, message: "Check the selected inventory items and quantities." }; }

  let feePaise: number;
  try { feePaise = rupeesToPaise(parsed.data.procedureFee || "0"); }
  catch (error) { return { ok: false, fieldErrors: { procedureFee: [(error as Error).message] } }; }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_procedure_sale", {
    p_patient_id: parsed.data.patientId,
    p_visit_id: null,
    p_doctor_id: parsed.data.doctorId || null,
    p_procedure_name: parsed.data.procedureName,
    p_procedure_fee_paise: feePaise,
    p_lines: lines,
    p_payment_mode: parsed.data.paymentMode,
    p_notes: parsed.data.notes || null,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error)
    return {
      ok: false,
      message: error.message.includes("insufficient inventory stock")
        ? "Not enough stock for one of the selected items. Nothing was billed."
        : error.message.includes("inventory item unavailable")
          ? "One of the selected items is no longer available."
          : "The procedure bill could not be created.",
    };

  revalidatePath("/pharmacy/inventory");
  return { ok: true, message: "Procedure bill created.", data: { saleId: String(data) } };
}
