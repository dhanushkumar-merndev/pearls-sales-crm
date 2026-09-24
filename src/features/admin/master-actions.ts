"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/dal";
import { rupeesToPaise } from "@/lib/domain/money";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { databaseIdSchema } from "@/lib/validation/database-id";
import { CHARGE_MASTER_CATEGORIES } from "@/lib/domain/charge-categories";
import { validateClinicalImportRows } from "./clinical-import-schema";
import type { ActionState } from "@/types/hospital";

const optionalId = z.string().uuid().optional().or(z.literal(""));
async function adminActor() {
  const actor = await requirePermission("manageUsers");
  return { actor, admin: createSupabaseAdminClient() };
}

export async function saveDepartment(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: optionalId, name: z.string().trim().min(2).max(100), description: z.string().trim().max(500).optional(), active: z.string().optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  const { actor, admin } = await adminActor();
  const values = { name: parsed.data.name, description: parsed.data.description || null, active: parsed.data.active === "on" };
  const query = parsed.data.id ? admin.from("departments").update(values).eq("id", parsed.data.id) : admin.from("departments").insert(values);
  const { error } = await query;
  if (error) return { ok: false, message: error.code === "23505" ? "This department already exists." : "Department could not be saved." };
  await admin.from("audit_logs").insert({ actor_user_id: actor.id, action: "DEPARTMENT_SAVED", entity_type: "department", entity_id: parsed.data.id || null });
  revalidatePath("/admin/masters");
  return { ok: true, message: "Department saved." };
}

export async function saveCharge(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: optionalId, category: z.enum(CHARGE_MASTER_CATEGORIES), name: z.string().trim().min(2).max(120), amount: z.string(), active: z.string().optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  let amount: number;
  try { amount = rupeesToPaise(parsed.data.amount); } catch (error) { return { ok: false, message: (error as Error).message }; }
  const { actor, admin } = await adminActor();
  const values = { category: parsed.data.category, charge_name: parsed.data.name, amount_paise: amount, active: parsed.data.active === "on" };
  const query = parsed.data.id ? admin.from("charges").update(values).eq("id", parsed.data.id) : admin.from("charges").insert(values);
  const { error } = await query;
  if (error) return { ok: false, message: error.code === "23505" ? "This charge already exists." : "Charge could not be saved." };
  await admin.from("audit_logs").insert({ actor_user_id: actor.id, action: "CHARGE_SAVED", entity_type: "charge", entity_id: parsed.data.id || null });
  revalidatePath("/admin/masters");
  return { ok: true, message: "Charge saved." };
}

export async function saveReportCategory(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: optionalId, name: z.string().trim().min(2).max(100), active: z.string().optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  const { actor, admin } = await adminActor();
  const values = { name: parsed.data.name, active: parsed.data.active === "on" };
  const query = parsed.data.id ? admin.from("report_categories").update(values).eq("id", parsed.data.id) : admin.from("report_categories").insert(values);
  const { error } = await query;
  if (error) return { ok: false, message: error.code === "23505" ? "This category already exists." : "Category could not be saved." };
  await admin.from("audit_logs").insert({ actor_user_id: actor.id, action: "REPORT_CATEGORY_SAVED", entity_type: "report_category", entity_id: parsed.data.id || null });
  revalidatePath("/admin/masters");
  return { ok: true, message: "Report category saved." };
}

export async function saveClinicalTerm(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: optionalId, type: z.string().trim().min(2).max(50), displayText: z.string().trim().min(2).max(300), aliases: z.string().trim().max(1000).optional(), source: z.string().trim().min(2).max(120), code: z.string().trim().max(50).optional(), codeSystem: z.string().trim().max(50).optional(), active: z.string().optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  const { actor, admin } = await adminActor();
  // A code without its system (or vice versa) is meaningless, so both are
  // dropped together rather than storing a code nobody can attribute --
  // this is how a hospital adds its own SNOMED-CT (or any other) coded terms
  // one at a time, the same code_system column the bulk import already writes.
  const values = { term_type: parsed.data.type, display_text: parsed.data.displayText, search_aliases: (parsed.data.aliases ?? "").split(",").map((item) => item.trim()).filter(Boolean), source: parsed.data.source, code: parsed.data.code && parsed.data.codeSystem ? parsed.data.code : null, code_system: parsed.data.code && parsed.data.codeSystem ? parsed.data.codeSystem : null, active: parsed.data.active === "on" };
  const query = parsed.data.id ? admin.from("clinical_terms").update(values).eq("id", parsed.data.id) : admin.from("clinical_terms").insert(values);
  const { error } = await query;
  if (error) return { ok: false, message: error.code === "23505" ? "This clinical term already exists." : "Clinical term could not be saved." };
  await admin.from("audit_logs").insert({ actor_user_id: actor.id, action: "CLINICAL_TERM_SAVED", entity_type: "clinical_term", entity_id: parsed.data.id || null });
  revalidatePath("/admin/clinical-directory");
  return { ok: true, message: "Clinical term saved." };
}

// A medicine is not in this list: it leaves the library through
// deleteMedicine (features/pharmacy/actions), whose RPC knows about batches
// and stock. Everything else shares delete_master_record.
const deletableMasterSchema = z.object({
  entity: z.enum(["department", "charge", "report_category", "clinical_term", "room_bed", "medicine_batch", "doctor"]),
  id: z.string().uuid(),
});

const deletePaths = {
  department: "/admin/masters",
  charge: "/admin/masters",
  report_category: "/admin/masters",
  clinical_term: "/admin/clinical-directory",
  room_bed: "/admin/masters",
  medicine_batch: "/pharmacy/stock",
  doctor: "/admin/doctors",
} as const;

/**
 * Removes one master record.
 *
 * The database decides between deleting and archiving, because only it can see
 * whether hospital history points at the row -- and for a clinical term the
 * foreign key would NOT have refused: consultation_diagnoses.term_id is
 * ON DELETE SET NULL, so a plain delete used to succeed and quietly blank the
 * link on every past diagnosis that used it.
 */
export async function deleteMasterRecord(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = deletableMasterSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Invalid delete request." };
  const { entity, id } = parsed.data;
  const { actor, admin } = await adminActor();

  // A batch is physical stock with its own ledger, not a master definition.
  if (entity === "medicine_batch") {
    const { error } = await admin.from("medicine_batches").delete().eq("id", id);
    if (error)
      return {
        ok: false,
        message: error.code === "23503"
          ? "This batch is already used by hospital history. Deactivate it instead of deleting it."
          : "This batch could not be deleted.",
      };
    await admin.from("audit_logs").insert({ actor_user_id: actor.id, action: "MASTER_RECORD_DELETED", entity_type: entity, entity_id: id });
    revalidatePath(deletePaths[entity]);
    revalidatePath("/dashboard");
    return { ok: true, message: "Batch permanently deleted." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("delete_master_record", {
    p_entity: entity,
    p_id: id,
  });
  if (error)
    return {
      ok: false,
      message: error.message.includes("record not found")
        ? "This record no longer exists. Refresh and try again."
        : "This record could not be removed.",
    };
  const result = (data ?? {}) as { mode?: string };
  revalidatePath(deletePaths[entity]);
  return {
    ok: true,
    message:
      result.mode === "deleted"
        ? "Deleted. It was never used, so nothing was left behind."
        : "Removed from the list. Every record that already uses it is unchanged.",
  };
}

/** Puts an archived master record back. */
export async function restoreMasterRecord(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = deletableMasterSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Invalid restore request." };
  await requirePermission("manageUsers");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("restore_master_record", {
    p_entity: parsed.data.entity,
    p_id: parsed.data.id,
  });
  if (error) return { ok: false, message: "This record could not be restored." };
  revalidatePath(deletePaths[parsed.data.entity]);
  return { ok: true, message: "Restored." };
}

/**
 * Removes a staff account.
 *
 * An account that has done any work is deactivated, not deleted: the profile
 * is who registered a patient or collected a payment, and deleting it would
 * erase that attribution. One created by mistake is removed for real, and its
 * sign-in goes with it.
 */
export async function deleteStaffUser(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Invalid removal request." };
  const { actor, admin } = await adminActor();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("delete_staff_profile", {
    p_user_id: parsed.data.id,
  });
  if (error)
    return {
      ok: false,
      message: error.message.includes("your own account")
        ? "You cannot remove your own account."
        : error.message.includes("last administrator")
          ? "This is the only active administrator. Promote another admin first."
          : error.message.includes("record not found")
            ? "This account no longer exists. Refresh and try again."
            : "This account could not be removed.",
    };
  const result = (data ?? {}) as { mode?: string; label?: string };
  // The profile is gone, so the sign-in must go too or the email cannot be
  // reused. A deactivated account keeps its login disabled by status instead.
  if (result.mode === "deleted") await admin.auth.admin.deleteUser(parsed.data.id);
  else await admin.auth.admin.updateUserById(parsed.data.id, { ban_duration: "876000h" });
  void actor;
  revalidatePath("/admin/users");
  revalidatePath("/admin/doctors");
  return {
    ok: true,
    message:
      result.mode === "deleted"
        ? "Account deleted. It had never been used, so nothing was left behind."
        : "Account deactivated and signed out. Everything they recorded keeps their name on it.",
  };
}

export async function saveHospitalSettings(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ hospitalName: z.string().trim().min(2).max(150), tagline: z.string().trim().max(120).optional(), address: z.string().trim().max(1000).optional(), phone: z.string().trim().max(30).optional(), email: z.string().trim().email().optional().or(z.literal("")), prescriptionFooter: z.string().trim().max(1000).optional(), tokenFooter: z.string().trim().max(500).optional(), digitalText: z.string().trim().max(1000).optional(), printFeeOnPrescription: z.string().optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  const { actor, admin } = await adminActor();
  const { error } = await admin.from("hospital_settings").upsert({ id: true, hospital_name: parsed.data.hospitalName, tagline: parsed.data.tagline || null, address: parsed.data.address || null, phone: parsed.data.phone || null, email: parsed.data.email || null, prescription_footer: parsed.data.prescriptionFooter || null, token_footer: parsed.data.tokenFooter || null, digital_prescription_text: parsed.data.digitalText || null, print_fee_on_prescription: parsed.data.printFeeOnPrescription === "on" });
  if (error) return { ok: false, message: "Hospital settings could not be saved." };
  await admin.from("audit_logs").insert({ actor_user_id: actor.id, action: "SETTINGS_UPDATED", entity_type: "hospital_settings" });
  revalidatePath("/admin/settings");
  return { ok: true, message: "Hospital settings saved." };
}


/**
 * One chunk of a clinical directory import. Re-validated server-side, then
 * handed to a single transactional RPC. Admin only.
 */
export async function importClinicalTerms(
  rows: unknown[],
  fileName: string,
  idempotencyKey: string,
): Promise<{ ok: boolean; message?: string; data?: Record<string, unknown> }> {
  // Permission check here, plus the RPC's own admin guard in the database.
  await requirePermission("manageUsers");
  const parsed = z
    .object({ fileName: z.string().min(1).max(255), idempotencyKey: databaseIdSchema })
    .safeParse({ fileName, idempotencyKey });
  if (!parsed.success) return { ok: false, message: "Import payload is invalid." };

  const checked = validateClinicalImportRows(rows);
  if (checked.invalid.length || checked.valid.length === 0)
    return { ok: false, message: "Resolve all validation errors before importing." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("bulk_import_clinical_terms", {
    p_rows: checked.valid,
    p_file_name: fileName,
    p_idempotency_key: idempotencyKey,
  });
  if (error) return { ok: false, message: "The transaction failed; no rows in this batch were saved." };

  revalidatePath("/admin/clinical-directory");
  return { ok: true, data: (data ?? {}) as Record<string, unknown> };
}
