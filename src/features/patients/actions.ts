"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile, requirePermission } from "@/lib/auth/dal";
import { validatePatientImportRows } from "./import-schema";
import { buildPatientRow, patientSchema, resolveDob } from "./patient-input";
import { normalizeIndianPhone } from "@/lib/domain/phone";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { databaseIdSchema } from "@/lib/validation/database-id";
import type { ActionState } from "@/types/hospital";

export async function createPatient(_: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("createPatient");
  const parsed = patientSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };

  const { row, phoneError } = buildPatientRow(parsed.data);
  if (!row) return { ok: false, fieldErrors: { phone: [phoneError] } };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("patients").insert(row).select("id").single();

  // Phone is deliberately no longer unique (families share numbers); only a
  // duplicate UHID can trip this now.
  if (error?.code === "23505") return { ok: false, fieldErrors: { uhid: ["This UHID already belongs to another patient."] } };
  if (error || !data) return { ok: false, message: "Patient could not be created. Please try again." };
  revalidatePath("/patients"); revalidatePath("/reception");
  return { ok: true, message: "Patient created.", data: { patientId: data.id } };
}

const patientUpdateSchema = patientSchema.extend({ patientId: databaseIdSchema, status: z.enum(["active", "archived"]) });
export async function updatePatient(_: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("createPatient"); const parsed = patientUpdateSchema.safeParse(Object.fromEntries(formData)); if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  let phone: string; try { phone = normalizeIndianPhone(parsed.data.phone); } catch (error) { return { ok: false, fieldErrors: { phone: [(error as Error).message] } }; }
  const { dob, approximate } = resolveDob(parsed.data.dob, parsed.data.age);
  const supabase = await createSupabaseServerClient(); const { error } = await supabase.from("patients").update({ name: parsed.data.name, ...(parsed.data.uhid ? { uhid: parsed.data.uhid.toUpperCase() } : {}), phone_normalized: phone, dob, dob_is_approximate: approximate, gender: parsed.data.gender, blood_group: parsed.data.bloodGroup || null, address: parsed.data.address || null, allergies: parsed.data.allergies || null, reference_detail: parsed.data.referenceDetail || null, status: parsed.data.status }).eq("id", parsed.data.patientId);
  if (error) return { ok: false, message: error.code === "23505" ? "That UHID already belongs to another patient." : "Patient could not be updated." };
  await createSupabaseAdminClient().from("audit_logs").insert({ actor_user_id: actor.id, action: parsed.data.status === "archived" ? "PATIENT_ARCHIVED" : "PATIENT_UPDATED", entity_type: "patient", entity_id: parsed.data.patientId });
  revalidatePath(`/patients/${parsed.data.patientId}`); revalidatePath("/patients"); return { ok: true, message: "Patient updated." };
}

const allergySchema = z.object({
  patientId: databaseIdSchema,
  allergies: z.string().trim().max(1000).optional(),
});

/**
 * Records an allergy from inside the consultation.
 *
 * The doctor is usually the one who finds out, and they cannot edit patients:
 * a dedicated RPC writes this one column so recording an allergy does not hand
 * clinical roles the rest of the patient record.
 */
export async function updatePatientAllergies(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await getCurrentProfile();
  if (!["admin", "doctor", "reception", "op"].includes(actor.role))
    return { ok: false, message: "You cannot change patient allergies." };
  const parsed = allergySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("update_patient_allergies", {
    p_patient_id: parsed.data.patientId,
    p_allergies: parsed.data.allergies || "",
  });
  if (error) return { ok: false, message: "Allergies could not be saved." };

  revalidatePath(`/patients/${parsed.data.patientId}`);
  revalidatePath("/visits", "layout");
  return {
    ok: true,
    message: parsed.data.allergies ? "Allergies updated." : "Allergies cleared.",
  };
}

const patientImportSchema = z.object({
  fileName: z.string().min(1).max(255),
  rows: z.string(),
  idempotencyKey: databaseIdSchema,
});

/**
 * One chunk of a bulk patient import. The browser has already validated every
 * row; this re-validates server-side (never trust the client) and hands the
 * chunk to a single transactional RPC.
 */
export async function importPatients(
  rows: unknown[],
  fileName: string,
  idempotencyKey: string,
): Promise<{ ok: boolean; message?: string; data?: Record<string, unknown> }> {
  await requirePermission("createPatient");
  const parsed = patientImportSchema.safeParse({ fileName, rows: JSON.stringify(rows), idempotencyKey });
  if (!parsed.success) return { ok: false, message: "Import payload is invalid." };

  const checked = validatePatientImportRows(rows);
  if (checked.invalid.length || checked.valid.length === 0)
    return { ok: false, message: "Resolve all validation errors before importing." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("bulk_import_patients", {
    p_rows: checked.valid,
    p_file_name: fileName,
    p_idempotency_key: idempotencyKey,
  });
  if (error) return { ok: false, message: "The transaction failed; no rows in this batch were saved." };

  revalidatePath("/patients");
  revalidatePath("/dashboard");
  return { ok: true, data: (data ?? {}) as Record<string, unknown> };
}
