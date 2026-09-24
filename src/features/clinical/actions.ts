"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { rupeesToPaise } from "@/lib/domain/money";
import { databaseIdSchema } from "@/lib/validation/database-id";
import type { ActionState } from "@/types/hospital";

const schema = z.object({
  visitId: databaseIdSchema,
  symptoms: z.string().max(5000).optional(),
  history: z.string().max(10000).optional(),
  examination: z.string().max(5000).optional(),
  assessment: z.string().min(1, "Assessment/diagnosis is required.").max(5000),
  // The joined display text of every row in `diagnoses` below -- still built
  // and sent by the client so every existing reader of consultations.assessment
  // (print, exports, dashboards) keeps working unchanged. See
  // 20260819120000_structured_diagnosis_entries for why this stays alongside
  // the new structured column instead of replacing it.
  diagnoses: z.string().max(20_000),
  advice: z.string().max(5000).optional(),
  followUpType: z.enum(["none", "after_report", "specific_date", "after_days"]),
  followUpDate: z.string().date().optional().or(z.literal("")),
  followUpDays: z.string().max(4).optional(),
  medicines: z.string().max(100_000),
  tests: z.string().max(50_000),
  fee: z.string().optional(),
  intent: z.enum(["draft", "complete"]),
});
const medicineSchema = z
  .array(
    z.object({
      medicine_id: databaseIdSchema.optional().or(z.literal("")),
      medicine_name: z.string().trim().min(1).max(300),
      dose: z.string().max(100).optional(),
      frequency: z.string().max(100).optional(),
      duration: z.string().max(100).optional(),
      route: z.string().max(100).optional(),
      notes: z.string().max(500).optional(),
      quantity: z.number().int().positive().max(100_000),
    }),
  )
  .max(30);
const testSchema = z
  .array(
    z.object({
      test_name: z.string().trim().min(1).max(300),
      category: z.string().trim().max(100).optional(),
      notes: z.string().max(1000).optional(),
    }),
  )
  .max(30);
const diagnosisSchema = z
  .array(
    z.object({
      term_id: databaseIdSchema.optional().or(z.literal("")),
      display_text: z.string().trim().min(1).max(300),
      code: z.string().max(50).optional(),
      code_system: z.string().max(50).optional(),
      status: z.enum(["provisional", "confirmed"]).default("provisional"),
      notes: z.string().max(1000).optional(),
    }),
  )
  .max(30);
/** A directory pick carries its code in brackets, e.g. "Asthma (J45.9)". */
const CODED_SUFFIX = /\s\([A-Z]\d{2}(\.\d+)?\)$/;

/**
 * Keeps what the doctor typed.
 *
 * A diagnosis or investigation written by hand is a gap in the directory: the
 * next doctor would have to type the same phrase again. Storing it makes it
 * searchable for everyone (AGENTS.md 20). Coded picks are already in there and
 * are skipped. Best effort -- a consultation is never failed over this.
 */
async function rememberTypedTerms(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  assessment: string,
  tests: z.infer<typeof testSchema>,
) {
  const terms = [
    ...assessment
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length >= 2 && !CODED_SUFFIX.test(line))
      .map((line) => ["diagnosis", line] as const),
    ...tests
      .map((test) => test.test_name.trim())
      .filter((name) => name.length >= 2)
      .map((name) => ["investigation", name] as const),
  ];
  await Promise.all(
    terms.map(([type, text]) =>
      supabase.rpc("add_clinical_term", { p_term_type: type, p_display_text: text }),
    ),
  );
}

export async function saveConsultation(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requirePermission("pharmacyEnterConsultation");
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  let medicines: z.infer<typeof medicineSchema>,
    tests: z.infer<typeof testSchema>,
    diagnoses: z.infer<typeof diagnosisSchema>;
  try {
    medicines = medicineSchema.parse(JSON.parse(parsed.data.medicines));
    tests = testSchema.parse(JSON.parse(parsed.data.tests));
    diagnoses = diagnosisSchema.parse(JSON.parse(parsed.data.diagnoses));
  } catch {
    return { ok: false, message: "Check diagnosis, medicine and investigation rows." };
  }
  const followUpDays = parsed.data.followUpDays
    ? Number(parsed.data.followUpDays)
    : null;
  if (
    parsed.data.followUpType === "after_days" &&
    (!Number.isInteger(followUpDays) || (followUpDays ?? 0) < 1 || (followUpDays ?? 0) > 365)
  )
    return {
      ok: false,
      fieldErrors: { followUpDays: ["Enter a duration from 1 to 365 days."] },
    };
  // The consulting doctor owns the fee; the pharmacy counter collects it.
  // 0 is a valid deliberate entry (free follow-up), blank is not.
  const rawFee = parsed.data.fee?.trim() ?? "";
  let feePaise: number | null = null;
  try {
    feePaise = rawFee === "" ? null : rupeesToPaise(rawFee);
  } catch (error) {
    return {
      ok: false,
      fieldErrors: { fee: [(error as Error).message] },
    };
  }
  if (parsed.data.intent === "complete") {
    if (feePaise === null || Number.isNaN(feePaise))
      return {
        ok: false,
        fieldErrors: {
          fee: ["Enter the consultation fee to complete this consultation."],
        },
      };
    if (feePaise < 0)
      return {
        ok: false,
        fieldErrors: { fee: ["Consultation fee cannot be negative."] },
      };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("save_visit_consultation", {
    p_visit_id: parsed.data.visitId,
    p_symptoms: parsed.data.symptoms || null,
    p_history: parsed.data.history || null,
    p_examination: parsed.data.examination || null,
    p_assessment: parsed.data.assessment,
    p_advice: parsed.data.advice || null,
    p_follow_up_type: parsed.data.followUpType,
    p_follow_up_date: parsed.data.followUpDate || null,
    p_follow_up_days: followUpDays,
    p_medicines: medicines,
    p_tests: tests,
    p_diagnoses: diagnoses,
    p_complete: parsed.data.intent === "complete",
    p_fee_paise: feePaise !== null && !Number.isNaN(feePaise) ? feePaise : null,
  });
  if (error)
    return {
      ok: false,
      message: error.message.includes("immutable")
        ? "This consultation is already completed and cannot be changed."
        : "Consultation could not be saved.",
    };
  await rememberTypedTerms(supabase, parsed.data.assessment, tests);
  revalidatePath(`/visits/${parsed.data.visitId}`);
  revalidatePath("/doctor");
  revalidatePath("/pharmacy");
  revalidatePath("/dashboard");
  return {
    ok: true,
    message:
      parsed.data.intent === "complete"
        ? "Consultation completed."
        : "Draft saved.",
    data: { completed: parsed.data.intent === "complete" },
  };
}

/**
 * Marks the visit as in consultation when the doctor opens it, so reception and
 * the OP desk can see who is actually inside the room. Safe to call repeatedly:
 * the RPC only moves a visit out of waiting / vitals pending / ready, and never
 * touches a completed or cancelled one.
 */
export async function startConsultation(visitId: string) {
  await requirePermission("pharmacyEnterConsultation");
  const parsed = databaseIdSchema.safeParse(visitId);
  if (!parsed.success) return { ok: false };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("start_visit_consultation", { p_visit_id: parsed.data });
  if (error) return { ok: false };
  revalidatePath("/op");
  revalidatePath("/doctor");
  revalidatePath("/reception");
  return { ok: true };
}
