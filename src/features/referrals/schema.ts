import { z } from "zod";
import { databaseIdSchema } from "@/lib/validation/database-id";
import { rupeesToPaise } from "@/lib/domain/money";

export const PAYOUT_STATUSES = ["pending", "paid", "not_eligible"] as const;
// Derived by report_referral_conversions; lead statuses pass through as-is.
export const REFERRAL_REPORT_STATUSES = [
  "incentive_due", "incentive_paid", "awaiting_payment", "package_pending",
  "not_eligible", "converted", "booked", "lost",
] as const;
export const LEAD_SOURCE_LABELS: Record<string, string> = { meta: "Meta", manual: "Manual", referral: "Referral" };

/** "12.5" → 1250 basis points. Up to two decimals, 0–100. */
export function percentToBps(value: string) {
  const normalized = value.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(normalized)) throw new Error("Enter a percentage with up to 2 decimals.");
  const [whole, fraction = ""] = normalized.split(".");
  const bps = Number.parseInt(whole, 10) * 100 + Number.parseInt(fraction.padEnd(2, "0"), 10);
  if (bps > 10000) throw new Error("Incentive cannot exceed 100%.");
  return bps;
}
export function formatBps(bps: number) {
  return `${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}

const percent = z.string().trim().transform((value, ctx) => {
  try { return percentToBps(value || "0"); } catch (error) {
    ctx.addIssue({ code: "custom", message: (error as Error).message });
    return z.NEVER;
  }
});
const paise = z.string().trim().transform((value, ctx) => {
  try { return rupeesToPaise(value || "0"); } catch (error) {
    ctx.addIssue({ code: "custom", message: (error as Error).message });
    return z.NEVER;
  }
});
const optionalText = (max: number) => z.string().trim().max(max).optional().default("");

export const partnerSchema = z.object({
  id: databaseIdSchema.or(z.literal("")).optional(),
  name: z.string().trim().min(2, "Enter the partner name.").max(160),
  organization: optionalText(160),
  phone: z.string().trim().max(40).optional().default("")
    .refine((value) => !value || /^(?:91)?[6-9]\d{9}$/.test(value.replace(/[\s()+-]/g, "")), "Enter a valid Indian mobile number."),
  incentive: percent,
  notes: optionalText(1000),
  active: z.string().optional(),
});
export const leadPartnerSchema = z.object({ leadId: databaseIdSchema, partnerId: databaseIdSchema.or(z.literal("")) });
export const leadPackageSchema = z.object({
  leadId: databaseIdSchema,
  packageName: z.string().trim().min(2, "Enter the procedure or package.").max(200),
  packageValue: paise,
  incentive: percent,
  payoutStatus: z.enum(PAYOUT_STATUSES),
  payoutReference: optionalText(200),
  notes: optionalText(1000),
});

export type PartnerOption = { id: string; name: string };
export type ReferralRow = {
  lead_id: string; lead_name: string | null; lead_phone: string | null; patient_id: string | null;
  patient_uhid: string | null; source: string; partner_id: string | null; partner_name: string | null;
  consultation_at: string | null; package_name: string | null; package_value_paise: number | null;
  collected_paise: number | null; converted_at: string | null; incentive_bps: number | null;
  incentive_paise: number | null; lead_status: string; payout_status: string | null; paid_at: string | null;
  payout_reference: string | null; package_notes: string | null; report_status: string;
  total_count: number; total_package_paise: number; total_collected_paise: number;
  total_incentive_due_paise: number; total_incentive_paid_paise: number;
};
