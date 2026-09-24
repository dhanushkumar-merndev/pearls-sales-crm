"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { databaseIdSchema } from "@/lib/validation/database-id";
import type { ActionState } from "@/types/hospital";

const optionalNumber = z.preprocess(
  (value) => (value === "" || value == null ? null : Number(value)),
  z.number().positive().nullable(),
);
const schema = z.object({
  visitId: databaseIdSchema,
  weight: optionalNumber,
  height: optionalNumber,
  temperature: z.preprocess(
    (value) => (value === "" || value == null ? null : Number(value)),
    z
      .number()
      .min(80, "Temperature must be at least 80 °F.")
      .max(115, "Temperature cannot exceed 115 °F.")
      .nullable(),
  ),
  systolic: optionalNumber,
  diastolic: optionalNumber,
  pulse: optionalNumber,
  spo2: optionalNumber,
  respiratoryRate: optionalNumber,
  notes: z.string().max(500).optional(),
});
const small = (value: number | null) =>
  value === null ? null : Math.round(value);

export async function saveVitals(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requirePermission("recordVitals");
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  if (parsed.data.spo2 !== null && parsed.data.spo2 > 100)
    return { ok: false, fieldErrors: { spo2: ["SpO₂ cannot exceed 100%."] } };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("record_visit_vitals", {
    p_visit_id: parsed.data.visitId,
    p_weight_kg: parsed.data.weight,
    p_height_cm: parsed.data.height,
    p_temperature_f: parsed.data.temperature,
    p_bp_systolic: small(parsed.data.systolic),
    p_bp_diastolic: small(parsed.data.diastolic),
    p_pulse: small(parsed.data.pulse),
    p_spo2: small(parsed.data.spo2),
    p_respiratory_rate: small(parsed.data.respiratoryRate),
    p_notes: parsed.data.notes || null,
  });
  if (error) return { ok: false, message: "Vitals could not be saved." };
  revalidatePath("/op");
  revalidatePath(`/visits/${parsed.data.visitId}`);
  revalidatePath("/dashboard");
  return { ok: true, message: "Vitals saved and patient marked ready." };
}
