import { z } from "zod";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { databaseIdSchema } from "@/lib/validation/database-id";
import type { ActionState } from "@/types/hospital";

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export const visitSchema = z.object({
  patientId: databaseIdSchema,
  doctorId: databaseIdSchema,
  visitType: z.enum(["op", "follow_up"]),
  previousVisitId: databaseIdSchema.optional().or(z.literal("")),
  notes: z.string().max(500).optional(),
  idempotencyKey: databaseIdSchema,
  consultants: z.string().max(20_000).optional(),
});

/** The same visit fields, for a form that carries the patient separately. */
export const visitWithoutPatientSchema = visitSchema.omit({ patientId: true });

// Registration captures no money. The consulting doctor sets the fee when the
// consultation is completed; reception or pharmacy collects it afterwards.
const NO_FEE_AT_REGISTRATION = 0;
const NO_PAYMENT_MODE = "cash" as const;

type VisitFields = z.infer<typeof visitWithoutPatientSchema>;

/**
 * Creates the visit and its token(s) for a patient that already exists.
 *
 * Shared by "create a visit for this patient" and by first-time registration,
 * which saves the patient and their first visit from one form. Callers own the
 * cache revalidation, because they know which pages they came from.
 */
export async function issueVisit(
  supabase: ServerClient,
  patientId: string,
  fields: VisitFields,
): Promise<ActionState> {
  if (fields.visitType === "follow_up" && !fields.previousVisitId)
    return { ok: false, fieldErrors: { previousVisitId: ["Select the related previous visit."] } };

  let consultants: Array<{ doctor_id: string; collected_paise: number }> = [];
  if (fields.consultants) {
    try {
      const raw = JSON.parse(fields.consultants) as Array<{ doctorId?: string }>;
      consultants = raw.map((item) => ({
        doctor_id: databaseIdSchema.parse(item.doctorId),
        collected_paise: NO_FEE_AT_REGISTRATION,
      }));
      if (!consultants.length || new Set(consultants.map((item) => item.doctor_id)).size !== consultants.length)
        return { ok: false, message: "Select each consultant only once." };
    } catch {
      return { ok: false, message: "Consultant details are invalid." };
    }
  }

  if (consultants.length > 1) {
    const { data, error } = await supabase.rpc("create_multi_consultant_visit", {
      p_patient_id: patientId,
      p_visit_type: fields.visitType,
      p_payment_mode: NO_PAYMENT_MODE,
      p_previous_visit_id: fields.previousVisitId || null,
      p_notes: fields.notes || null,
      p_idempotency_key: fields.idempotencyKey,
      p_consultants: consultants,
    });
    // Each consultant issues from their own daily series, so this returns one
    // row (and one token) per doctor rather than a single shared number.
    const rows = (Array.isArray(data) ? data : data ? [data] : []) as Array<{
      visit_id: string;
      token_number: number;
      doctor_name: string;
    }>;
    if (error || !rows.length)
      return {
        ok: false,
        message: error?.message.includes("duplicate")
          ? "Select each consultant only once."
          : "Multi-doctor visit could not be created.",
      };
    return {
      ok: true,
      message: `Visit created. ${rows.map((row) => `${row.doctor_name}: token #${row.token_number}`).join(", ")}`,
      data: { visitId: rows[0].visit_id, token: rows[0].token_number },
    };
  }

  const { data, error } = await supabase.rpc("create_visit_with_token", {
    p_patient_id: patientId,
    p_doctor_id: fields.doctorId,
    p_visit_type: fields.visitType,
    p_fee_paise: NO_FEE_AT_REGISTRATION,
    p_collected_paise: NO_FEE_AT_REGISTRATION,
    p_payment_mode: NO_PAYMENT_MODE,
    p_previous_visit_id: fields.previousVisitId || null,
    p_notes: fields.notes || null,
    p_idempotency_key: fields.idempotencyKey,
  });
  const result = Array.isArray(data) ? data[0] : data;
  if (error || !result)
    return { ok: false, message: "Visit could not be created. Please retry with the same form." };
  return { ok: true, message: "Visit created.", data: { visitId: result.visit_id, token: result.token_number } };
}
