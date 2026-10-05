import { requireApiPermission } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatHospitalDate } from "@/lib/domain/date";
import { parseReferralQuery, referralRpcArgs } from "@/features/referrals/query";
import { LEAD_SOURCE_LABELS, formatBps, type ReferralRow } from "@/features/referrals/schema";

// One download covers a filtered range; the RPC caps a single call at 5,000 rows.
const MAX_ROWS = 5000;
const HEADERS = ["Sl. No.", "Patient ID / Reference", "Name", "Lead Source", "Referral Partner", "Consultation Date", "Procedure / Package", "Package Value", "Amount Collected", "Conversion Date", "Incentive %", "Incentive Amount", "Status", "Paid On", "Payout Reference"];

const rupees = (paise: number | null) => (paise == null ? "" : (Number(paise) / 100).toFixed(2));
function cell(value: unknown) {
  let text = value == null ? "" : String(value);
  // Spreadsheet formula injection: a name like "=HYPERLINK(...)" must stay text.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET(request: Request) {
  const { response } = await requireApiPermission("manageReferrals");
  if (response) return response;
  const query = parseReferralQuery(Object.fromEntries(new URL(request.url).searchParams));
  const db = await createSupabaseServerClient();
  const { data, error } = await db.rpc("report_referral_conversions", referralRpcArgs(query, MAX_ROWS, 0));
  if (error) return Response.json({ error: "The referral report could not be exported." }, { status: 500 });
  const rows = (data ?? []) as ReferralRow[];
  const lines = rows.map((row, index) => [
    index + 1, row.patient_uhid ?? row.lead_phone ?? "", row.lead_name ?? "", LEAD_SOURCE_LABELS[row.source] ?? row.source,
    row.partner_name ?? "", row.consultation_at ? formatHospitalDate(row.consultation_at) : "", row.package_name ?? "",
    rupees(row.package_value_paise), rupees(row.collected_paise), row.converted_at ? formatHospitalDate(row.converted_at) : "",
    row.incentive_bps != null ? formatBps(row.incentive_bps) : "", rupees(row.incentive_paise),
    row.report_status.replaceAll("_", " "), row.paid_at ? formatHospitalDate(row.paid_at) : "", row.payout_reference ?? "",
  ].map(cell).join(","));
  const body = `﻿${[HEADERS.map(cell).join(","), ...lines].join("\r\n")}\r\n`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="referrals-${query.from}-to-${query.to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
