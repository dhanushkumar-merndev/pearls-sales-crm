"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/dal";
import { rupeesToPaise } from "@/lib/domain/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { databaseIdSchema } from "@/lib/validation/database-id";
import type { ActionState } from "@/types/hospital";
import { isIdempotentReplay } from "@/lib/domain/idempotency";
import { issueVisit, visitSchema } from "./issue-visit";

export async function createVisit(_: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("createVisit");
  const parsed = visitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  const { patientId, ...fields } = parsed.data;
  const supabase = await createSupabaseServerClient();
  const result = await issueVisit(supabase, patientId, fields);
  if (!result.ok) return result;
  revalidatePath(`/patients/${patientId}`); revalidatePath("/reception"); revalidatePath("/op"); revalidatePath("/dashboard");
  revalidatePath("/reception/lead-appointments"); revalidatePath("/leads"); revalidatePath("/leads/booked");
  return result;
}

/** Create the linked visit, then take reception directly to its new token. */
export async function createFollowUpVisit(
  previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await createVisit(previous, formData);
  const visitId = result.data?.visitId;
  if (result.ok && typeof visitId === "string") redirect(`/visits/${visitId}`);
  return result;
}

const reassignSchema=z.object({visitId:databaseIdSchema,doctorId:databaseIdSchema,reason:z.string().trim().min(3,"Enter a short reason.").max(500)});
export async function reassignVisitConsultant(_:ActionState,formData:FormData):Promise<ActionState>{
  await requirePermission("createVisit");const parsed=reassignSchema.safeParse(Object.fromEntries(formData));
  if(!parsed.success)return{ok:false,fieldErrors:parsed.error.flatten().fieldErrors};
  const supabase=await createSupabaseServerClient();const{error}=await supabase.rpc("reassign_visit_consultant",{p_visit_id:parsed.data.visitId,p_doctor_id:parsed.data.doctorId,p_reason:parsed.data.reason});
  if(error){const message=error.message.includes("different consultant")?"Select a different consultant.":error.message.includes("clinical work")||error.message.includes("no longer")?"Consultant cannot be changed because clinical work has started or the visit is closed.":error.message.includes("unavailable")?"The selected consultant is unavailable.":"Consultant could not be changed.";return{ok:false,message};}
  revalidatePath("/reception");revalidatePath(`/visits/${parsed.data.visitId}`);revalidatePath("/dashboard");return{ok:true,message:"Consultant changed. A new token was issued from the new doctor's series."};
}

const addConsultantSchema = reassignSchema.extend({ idempotencyKey: databaseIdSchema });
export async function addConsultantToToken(_: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("createVisit");
  const parsed = addConsultantSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("add_consultant_to_token", {
    p_source_visit_id: parsed.data.visitId,
    p_doctor_id: parsed.data.doctorId,
    p_reason: parsed.data.reason,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) {
    const message = error.message.includes("already assigned") ? "This doctor is already assigned to this token."
      : error.message.includes("no longer") ? "Another consultant cannot be added after clinical work starts or the visit closes."
      : error.message.includes("unavailable") ? "The selected consultant is unavailable."
      : "Consultant could not be added.";
    return { ok: false, message };
  }
  revalidatePath("/reception"); revalidatePath("/op"); revalidatePath("/dashboard");
  return { ok: true, message: "Consultant added with a token from that doctor's own series." };
}

const paymentSchema = z.object({ visitId: databaseIdSchema, patientId: databaseIdSchema.optional().or(z.literal("")), amount: z.string(), mode: z.enum(["cash", "upi", "card", "bank_transfer", "other"]), reference: z.string().max(100).optional(), idempotencyKey: databaseIdSchema });
/**
 * Settles a visit's outstanding fee directly -- the counterpart to the
 * consultation fee dispense_prescription collects when the visit actually
 * has medicines. A visit with none (e.g. a procedure consultation)
 * never reaches the pharmacy queue, so it had no way to ever be settled.
 * The prevent_visit_overpayment trigger is the real guard against collecting
 * more than is owed; this only pre-checks it for a friendlier message.
 */
export async function addVisitPayment(_: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("collectVisitPayment");
  const parsed = paymentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  let amount: number; try { amount = rupeesToPaise(parsed.data.amount); } catch (error) { return { ok: false, message: (error as Error).message }; }
  if (amount <= 0) return { ok: false, fieldErrors: { amount: ["Amount must be greater than zero."] } };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("visit_payments").insert({ visit_id: parsed.data.visitId, amount_paise: amount, mode: parsed.data.mode, reference: parsed.data.reference || null, idempotency_key: parsed.data.idempotencyKey });
  if (isIdempotentReplay(error)) return { ok: true, message: "Payment was already recorded." };
  if (error)
    return {
      ok: false,
      message: error.message.includes("exceeds outstanding")
        ? "That is more than the outstanding balance."
        : "Payment could not be recorded.",
    };
  if (parsed.data.patientId) revalidatePath(`/patients/${parsed.data.patientId}`);
  revalidatePath(`/visits/${parsed.data.visitId}`);
  revalidatePath("/reception");
  revalidatePath("/reception/payments");
  revalidatePath("/pharmacy");
  revalidatePath("/dashboard");
  return { ok: true, message: "Payment recorded." };
}
