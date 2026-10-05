"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionState } from "@/types/hospital";
import { leadPackageSchema, leadPartnerSchema, partnerSchema } from "./schema";

// Only known staff-facing messages leave the server; never raw SQL errors.
const KNOWN = [
  "A partner with this name already exists.", "Enter a valid 10-digit mobile number.",
  "Choose an active referral partner.", "The incentive for this lead is already paid.",
  "Only a converted referral can be marked paid.",
  "Reopen the payout (set it to pending) before changing a paid incentive.",
];
function failure(error: { code?: string; message?: string }, fallback: string): ActionState {
  if (error.code === "42501") return { ok: false, message: "Your access has changed. Refresh the page." };
  return { ok: false, message: KNOWN.find((message) => message === error.message) ?? fallback };
}
function refresh(leadId?: string) {
  revalidatePath("/admin/referrals");
  revalidatePath("/leads");
  if (leadId) revalidatePath(`/leads/${leadId}`);
}

export async function saveReferralPartner(_: ActionState, form: FormData): Promise<ActionState> {
  await requirePermission("manageReferrals");
  const parsed = partnerSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Check the partner details.", fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("save_referral_partner", {
    p_id: v.id || null, p_name: v.name, p_organization: v.organization || null, p_phone: v.phone || null,
    p_incentive_bps: v.incentive, p_notes: v.notes || null, p_active: v.active === "on",
  });
  if (error) return failure(error, "Partner could not be saved.");
  refresh();
  return { ok: true, message: "Referral partner saved." };
}

export async function setLeadReferralPartner(_: ActionState, form: FormData): Promise<ActionState> {
  await requirePermission("manageReferrals");
  const parsed = leadPartnerSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Choose a referral partner." };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("set_lead_referral_partner", { p_lead_id: parsed.data.leadId, p_partner_id: parsed.data.partnerId || null });
  if (error) return failure(error, "Referral partner could not be updated.");
  refresh(parsed.data.leadId);
  return { ok: true, message: "Referral partner updated." };
}

export async function saveLeadPackage(_: ActionState, form: FormData): Promise<ActionState> {
  await requirePermission("manageReferrals");
  const parsed = leadPackageSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Check the package details.", fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("save_lead_package", {
    p_lead_id: v.leadId, p_package_name: v.packageName, p_package_value_paise: v.packageValue,
    p_incentive_bps: v.incentive, p_payout_status: v.payoutStatus,
    p_payout_reference: v.payoutReference || null, p_notes: v.notes || null,
  });
  if (error) return failure(error, "Package could not be saved.");
  refresh(v.leadId);
  return { ok: true, message: v.payoutStatus === "paid" ? "Incentive marked paid." : "Package saved." };
}
