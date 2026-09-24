"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/dal";
import { buildPatientRow, patientSchema } from "@/features/patients/patient-input";
import { issueVisit, visitWithoutPatientSchema } from "@/features/visits/issue-visit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionState } from "@/types/hospital";

/**
 * First-time registration in one submit: the patient record and their first
 * visit with its token.
 *
 * A brand new patient always needs both, so splitting them into two screens
 * only made reception fill one form, wait, then fill another. Existing patients
 * still go through Create Visit on its own.
 *
 * If the patient saves but the visit does not, the patient is deliberately kept
 * and returned: they now exist in the register, and the desk only has to retry
 * the visit rather than type the demographics again.
 */
export async function registerPatientWithVisit(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requirePermission("createPatient");
  await requirePermission("createVisit");

  const values = Object.fromEntries(formData);
  const patient = patientSchema.safeParse(values);
  const visit = visitWithoutPatientSchema.safeParse(values);
  if (!patient.success || !visit.success)
    return {
      ok: false,
      fieldErrors: {
        ...(patient.success ? {} : patient.error.flatten().fieldErrors),
        ...(visit.success ? {} : visit.error.flatten().fieldErrors),
      },
      message: visit.success ? undefined : "Select the consulting doctor.",
    };

  const { row, phoneError } = buildPatientRow(patient.data);
  if (!row) return { ok: false, fieldErrors: { phone: [phoneError] } };

  const supabase = await createSupabaseServerClient();
  // The UHID is issued by a database trigger and is the visible Patient ID, so
  // it comes back with the row rather than being derived from the phone number
  // (several patients in one family share one number).
  const { data, error } = await supabase
    .from("patients")
    .insert(row)
    .select("id,uhid")
    .single();
  if (error?.code === "23505")
    return { ok: false, fieldErrors: { uhid: ["This UHID already belongs to another patient."] } };
  if (error || !data) return { ok: false, message: "Patient could not be created. Please try again." };

  const result = await issueVisit(supabase, data.id, visit.data);
  revalidatePath("/patients");
  revalidatePath("/reception");
  revalidatePath("/op");
  revalidatePath("/dashboard");

  if (!result.ok)
    return {
      ...result,
      message: `${patient.data.name} was registered, but the visit could not be created. ${result.message ?? ""}`.trim(),
      data: { ...(result.data ?? {}), patientId: data.id, uhid: data.uhid },
    };

  return { ...result, data: { ...(result.data ?? {}), patientId: data.id, uhid: data.uhid } };
}
