import { z } from "zod";
import { databaseIdSchema } from "@/lib/validation/database-id";

export const LEAD_STATUSES = ["new", "contacted", "interested", "booked", "converted", "lost"] as const;
export const leadIdSchema = z.object({ leadId: databaseIdSchema });
const optionalText = (max: number) => z.string().trim().max(max).optional().default("");
// Inputs are explicitly clinic time, independent of the staff member's browser timezone.
export const clinicDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Enter a date and time.")
  .refine((value) => {
    const date = new Date(`${value}:00+05:30`);
    return Number.isFinite(date.getTime()) && new Date(date.getTime() + 330 * 60000).toISOString().slice(0, 16) === value;
  }, "Enter a valid date and time.")
  .transform((value) => new Date(`${value}:00+05:30`).toISOString());
const optionalDateTime = z.union([z.literal(""), clinicDateTime]).optional();
export const manualLeadSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the person's name.").max(160),
  phone: z.string().trim().max(40).refine((value) => /^(?:91)?[6-9]\d{9}$/.test(value.replace(/[\s()+-]/g, "")), "Enter a valid Indian mobile number."),
  email: z.union([z.literal(""), z.email().max(254)]).optional(),
  city: optionalText(120), procedureInterest: optionalText(200), message: optionalText(4000),
  assignTo: databaseIdSchema.or(z.literal("")).optional(), referralPartnerId: databaseIdSchema.or(z.literal("")).optional(), idempotencyKey: databaseIdSchema,
});
export const leadNoteSchema = leadIdSchema.extend({
  type: z.enum(["note", "call"]), body: optionalText(4000), nextFollowUpAt: optionalDateTime,
  clearFollowUp: z.enum(["on", ""]).optional(),
}).refine((value) => !!(value.body || value.nextFollowUpAt || value.clearFollowUp === "on"), { message: "Write a note or set a follow-up.", path: ["body"] });
export const leadStatusSchema = leadIdSchema.extend({
  status: z.enum(["contacted", "interested", "lost"]), note: optionalText(4000),
  nextFollowUpAt: optionalDateTime, lostReason: optionalText(500),
}).refine((value) => value.status !== "lost" || value.lostReason.length >= 2, { message: "Give a reason for marking this lead lost.", path: ["lostReason"] });
export const leadBookingSchema = leadIdSchema.extend({
  appointmentAt: clinicDateTime, patientId: databaseIdSchema.or(z.literal("")).optional(),
  patientName: z.string().trim().min(2).max(160), gender: z.enum(["male", "female", "other", "unknown"]), note: optionalText(4000),
});
export const leadAssignmentSchema = leadIdSchema.extend({ profileId: databaseIdSchema.or(z.literal("")) });
export type Lead = {
  id: string; full_name: string | null; phone_raw: string | null; phone_normalized: string | null;
  email: string | null; city: string | null; procedure_interest: string | null; message: string | null;
  source: string; status: typeof LEAD_STATUSES[number]; assigned_to: string | null; lost_reason: string | null;
  next_follow_up_at: string | null; appointment_at: string | null; received_at: string;
  patient_id: string | null; converted_visit_id: string | null; meta_form_name: string | null;
  referral_partner_id?: string | null;
};
export type Owner = { id: string; full_name: string };
export type PatientMatch = { patient_id: string; name: string; uhid: string; gender: string };
