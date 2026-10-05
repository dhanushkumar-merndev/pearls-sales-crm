import { databaseIdSchema } from "@/lib/validation/database-id";
import { REFERRAL_REPORT_STATUSES } from "./schema";

export type ReferralSearch = { from?: string; to?: string; q?: string; source?: string; partner?: string; status?: string; page?: string; tab?: string };

function clinicDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(date);
}
const isDate = (value?: string) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") && Number.isFinite(new Date(`${value}T00:00:00Z`).getTime());

/** Validated filters shared by the page and the CSV download. Default: last 90 days. */
export function parseReferralQuery(params: ReferralSearch, now = new Date()) {
  const start = new Date(now);
  start.setDate(start.getDate() - 89);
  return {
    from: isDate(params.from) ? params.from! : clinicDate(start),
    to: isDate(params.to) ? params.to! : clinicDate(now),
    q: (params.q ?? "").trim().slice(0, 160),
    source: ["meta", "manual", "referral"].includes(params.source ?? "") ? params.source! : null,
    partner: databaseIdSchema.safeParse(params.partner).success ? params.partner! : null,
    status: (REFERRAL_REPORT_STATUSES as readonly string[]).includes(params.status ?? "") ? params.status! : null,
    page: Math.min(100000, Math.max(1, Math.floor(Number(params.page)) || 1)),
  };
}

export function referralRpcArgs(query: ReturnType<typeof parseReferralQuery>, limit: number, offset: number) {
  return {
    p_from: query.from, p_to: query.to, p_source: query.source, p_partner_id: query.partner,
    p_status: query.status, p_search: query.q || null, p_limit: limit, p_offset: offset,
  };
}
