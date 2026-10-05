"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionState } from "@/types/hospital";
import { manualLeadSchema, leadNoteSchema, leadStatusSchema, leadBookingSchema, leadAssignmentSchema } from "./schema";

function refreshLeads(id?: string) {
  for (const path of ["/leads", "/leads/follow-ups", "/leads/booked", "/reception/lead-appointments", "/dashboard", "/patients"]) revalidatePath(path);
  if (id) revalidatePath(`/leads/${id}`);
}
function failure(error: { code?: string; message?: string }): ActionState {
  if (error.code === "42501") return { ok: false, message: "This lead is no longer assigned to you, or your access has changed. Refresh the page." };
  // Only known staff-facing messages leave the server; never return raw SQL errors.
  const messages = ["A converted lead is closed.", "Choose an active sales executive.", "That patient does not match this lead's phone number.", "Add a valid 10-digit mobile number before booking.", "Pick an appointment date and time.", "Choose an active referral partner."];
  return { ok: false, message: messages.find((message) => error.message === message) ?? "Could not save this lead. Please refresh and try again." };
}
export async function createManualLead(_: ActionState, form: FormData): Promise<ActionState> {
  await requirePermission("workLeads");
  const parsed = manualLeadSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Check the enquiry details.", fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  const db = await createSupabaseServerClient();
  const { data, error } = await db.rpc("create_manual_lead", { p_full_name: v.fullName, p_phone: v.phone, p_email: v.email || null, p_city: v.city || null, p_procedure_interest: v.procedureInterest || null, p_message: v.message || null, p_assign_to: v.assignTo || null, p_idempotency_key: v.idempotencyKey, p_referral_partner_id: v.referralPartnerId || null });
  if (error) return failure(error);
  refreshLeads();
  return { ok: true, message: "Enquiry created.", data: { leadId: data } };
}
export async function addLeadNote(_: ActionState, form: FormData): Promise<ActionState> {
  await requirePermission("workLeads");
  const parsed = leadNoteSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Write a note or check the follow-up time.", fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("add_lead_note", { p_lead_id: v.leadId, p_type: v.type, p_body: v.body, p_next_follow_up_at: v.nextFollowUpAt || null, p_clear_follow_up: v.clearFollowUp === "on" });
  if (error) return failure(error);
  refreshLeads(v.leadId);
  return { ok: true, message: "Activity saved." };
}
export async function updateLeadStatus(_: ActionState, form: FormData): Promise<ActionState> {
  await requirePermission("workLeads");
  const parsed = leadStatusSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Check the status and reason.", fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("update_lead_status", { p_lead_id: v.leadId, p_status: v.status, p_note: v.note, p_next_follow_up_at: v.nextFollowUpAt || null, p_lost_reason: v.lostReason || null });
  if (error) return failure(error);
  refreshLeads(v.leadId);
  return { ok: true, message: "Status updated." };
}
export async function bookLeadAppointment(_: ActionState, form: FormData): Promise<ActionState> {
  await requirePermission("workLeads");
  const parsed = leadBookingSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Check the appointment and patient details.", fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  if (new Date(v.appointmentAt).getTime() < Date.now()) return { ok: false, message: "Choose an appointment in the future." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("convert_lead", { p_lead_id: v.leadId, p_appointment_at: v.appointmentAt, p_patient_id: v.patientId || null, p_patient_name: v.patientName, p_gender: v.gender, p_note: v.note });
  if (error) return failure(error);
  refreshLeads(v.leadId);
  return { ok: true, message: "Appointment booked. Reception can create the visit when the patient arrives." };
}
export async function assignLead(_: ActionState, form: FormData): Promise<ActionState> {
  await requirePermission("manageLeads");
  const parsed = leadAssignmentSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Choose a sales executive." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("assign_lead", { p_lead_id: parsed.data.leadId, p_profile_id: parsed.data.profileId || null });
  if (error) return failure(error);
  refreshLeads(parsed.data.leadId);
  return { ok: true, message: "Assignment updated." };
}
