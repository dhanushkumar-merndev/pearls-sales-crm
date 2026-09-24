"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { databaseIdSchema } from "@/lib/validation/database-id";
import type { ActionState } from "@/types/hospital";
const schema = z.object({
  patientId: databaseIdSchema,
  visitId: databaseIdSchema.optional().or(z.literal("")),
  testOrderId: databaseIdSchema.optional().or(z.literal("")),
  categoryId: databaseIdSchema,
  reportName: z.string().min(2).max(150),
  reportDate: z.string().date(),
  notes: z.string().max(1000).optional(),
});
const allowed = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const extensions: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
function matchesSignature(type: string, bytes: Uint8Array) {
  if (type === "application/pdf") return String.fromCharCode(...bytes.slice(0, 4)) === "%PDF";
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index]);
  if (type === "image/webp") return String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return false;
}
export async function uploadReport(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requirePermission("uploadReport");
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, fieldErrors: { file: ["Choose a report file."] } };
  if (!allowed.has(file.type))
    return {
      ok: false,
      fieldErrors: {
        file: ["Only PDF, JPG, PNG, and WEBP files are allowed."],
      },
    };
  const maximumBytes = Math.min(Number(process.env.PATIENT_DOCUMENT_MAX_BYTES ?? 1_048_576), 1_048_576);
  if (file.size > maximumBytes)
    return {
      ok: false,
      fieldErrors: { file: ["Maximum report size is 1 MB."] },
    };
  const signature = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!matchesSignature(file.type, signature))
    return { ok: false, fieldErrors: { file: ["The file content does not match its reported type."] } };
  const supabase = await createSupabaseServerClient();
  const objectId = crypto.randomUUID();
  const path = `${parsed.data.patientId}/${parsed.data.categoryId}/${objectId}.${extensions[file.type]}`;
  const { error: storageError } = await supabase.storage
    .from("patient-documents")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (storageError)
    return {
      ok: false,
      message: "The private report file could not be uploaded.",
    };
  const { data, error } = await supabase
    .from("patient_reports")
    .insert({
      patient_id: parsed.data.patientId,
      visit_id: parsed.data.visitId || null,
      test_order_id: parsed.data.testOrderId || null,
      category_id: parsed.data.categoryId,
      report_name: parsed.data.reportName,
      report_date: parsed.data.reportDate,
      display_name: parsed.data.reportName,
      original_filename: file.name,
      object_path: path,
      mime_type: file.type,
      size_bytes: file.size,
      notes: parsed.data.notes || null,
      uploaded_by: profile.id,
      status: "ready",
    })
    .select("id")
    .single();
  if (error || !data) {
    await createSupabaseAdminClient().storage.from("patient-documents").remove([path]);
    return {
      ok: false,
      message: "Report metadata failed; the uploaded file was rolled back.",
    };
  }
  revalidatePath("/reports");
  revalidatePath(`/patients/${parsed.data.patientId}`);
  if (parsed.data.visitId) revalidatePath(`/visits/${parsed.data.visitId}`);
  revalidatePath("/dashboard");
  return { ok: true, message: "Report uploaded privately." };
}

const reviewSchema = z.object({ reportId: databaseIdSchema });
export async function reviewReport(_: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("writeConsultation");
  const parsed = reviewSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Invalid report." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("review_patient_report", { p_report_id: parsed.data.reportId });
  if (error) return { ok: false, message: "The report could not be marked reviewed." };
  revalidatePath("/doctor/follow-ups"); revalidatePath("/reports");
  return { ok: true, message: "Reviewed" };
}
