import Link from "next/link";
import { Download } from "lucide-react";
import { requireRoute } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatHospitalDate } from "@/lib/domain/date";
import { formatInr } from "@/lib/domain/money";
import { containsSearchPattern } from "@/lib/domain/search";
import { PageHeader } from "@/components/shared/page-header";
import { FilterTabs } from "@/components/shared/filter-tabs";
import { StatusBadge } from "@/components/shared/status-badge";
import { DebouncedSearchInput } from "@/components/shared/debounced-search-input";
import { PAGE_SIZE, TablePagination, rangeFor } from "@/components/shared/table-pagination";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LeadPackageDialog, PartnerDialog, ReferralFilters, type PartnerItem } from "@/features/referrals/forms";
import { parseReferralQuery, referralRpcArgs, type ReferralSearch } from "@/features/referrals/query";
import { LEAD_SOURCE_LABELS, formatBps, type PartnerOption, type ReferralRow } from "@/features/referrals/schema";

const TABS = [{ label: "Conversions", value: "conversions" }, { label: "Partners", value: "partners" }];

export default async function ReferralsPage({ searchParams }: { searchParams: Promise<ReferralSearch> }) {
  await requireRoute("/admin/referrals");
  const params = await searchParams;
  const tab = params.tab === "partners" ? "partners" : "conversions";
  return <div>
    <PageHeader title="Referrals" description="Referral partners, converted packages and partner incentives" actions={tab === "partners" ? <PartnerDialog /> : null} />
    <FilterTabs ariaLabel="Select referrals view" active={tab} param="tab" tabs={TABS} />
    {tab === "partners" ? <PartnersTable params={params} /> : <ConversionsTable params={params} />}
  </div>;
}

async function ConversionsTable({ params }: { params: ReferralSearch }) {
  const query = parseReferralQuery(params);
  const db = await createSupabaseServerClient();
  const [report, partners] = await Promise.all([
    db.rpc("report_referral_conversions", referralRpcArgs(query, PAGE_SIZE, rangeFor(query.page)[0])),
    db.from("referral_partners").select("id,name").order("name").limit(500),
  ]);
  if (report.error || partners.error) throw new Error("The referral report could not be loaded. Please retry.");
  const rows = (report.data ?? []) as ReferralRow[];
  const totals = rows[0];
  const keep = { tab: "conversions", from: query.from, to: query.to, q: query.q, source: query.source ?? undefined, partner: query.partner ?? undefined, status: query.status ?? undefined };
  const exportHref = `/api/admin/referrals/export?${new URLSearchParams(Object.entries(keep).filter((entry): entry is [string, string] => !!entry[1]))}`;
  const cards: Array<[string, number]> = [
    ["Package value", Number(totals?.total_package_paise ?? 0)], ["Amount collected", Number(totals?.total_collected_paise ?? 0)],
    ["Incentive due", Number(totals?.total_incentive_due_paise ?? 0)], ["Incentive paid", Number(totals?.total_incentive_paid_paise ?? 0)],
  ];
  const offset = rangeFor(query.page)[0];
  return <>
    <form className="mb-4 flex flex-wrap items-end gap-3">
      <input type="hidden" name="tab" value="conversions" />
      {query.source ? <input type="hidden" name="source" value={query.source} /> : null}
      {query.partner ? <input type="hidden" name="partner" value={query.partner} /> : null}
      {query.status ? <input type="hidden" name="status" value={query.status} /> : null}
      {query.q ? <input type="hidden" name="q" value={query.q} /> : null}
      <div className="space-y-1"><label htmlFor="referral-from" className="text-xs font-medium">From</label><Input id="referral-from" name="from" type="date" defaultValue={query.from} /></div>
      <div className="space-y-1"><label htmlFor="referral-to" className="text-xs font-medium">To</label><Input id="referral-to" name="to" type="date" defaultValue={query.to} /></div>
      <Button type="submit" variant="outline">Apply range</Button>
      <Button variant="outline" render={<a href={exportHref} download />}><Download />Export CSV</Button>
    </form>
    <section className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
      {cards.map(([label, value]) => <Card key={label}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{formatInr(value)}</p></CardContent></Card>)}
    </section>
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      <DebouncedSearchInput initialValue={query.q} placeholder="Search name, mobile, patient ID or partner" ariaLabel="Search referrals" delay={250} className="min-w-48 flex-1" />
      <ReferralFilters source={query.source ?? undefined} partner={query.partner ?? undefined} status={query.status ?? undefined} partners={(partners.data ?? []) as PartnerOption[]} />
    </div>
    <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table>
      <TableHeader><TableRow>
        <TableHead className="text-right">Sl. No.</TableHead><TableHead>Patient ID / Reference</TableHead><TableHead>Lead Source</TableHead><TableHead>Referral Partner</TableHead>
        <TableHead>Consultation Date</TableHead><TableHead>Procedure / Package</TableHead><TableHead className="text-right">Package Value</TableHead><TableHead className="text-right">Amount Collected</TableHead>
        <TableHead>Conversion Date</TableHead><TableHead className="text-right">Incentive % / Amount</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {rows.map((row, index) => <TableRow key={row.lead_id}>
          <TableCell className="text-right tabular-nums text-muted-foreground">{offset + index + 1}</TableCell>
          <TableCell><Link href={`/leads/${row.lead_id}`} className="font-medium hover:underline">{row.lead_name ?? "Unnamed enquiry"}</Link><div className="text-xs text-muted-foreground tabular-nums">{row.patient_uhid ?? row.lead_phone ?? "—"}</div></TableCell>
          <TableCell>{LEAD_SOURCE_LABELS[row.source] ?? row.source}</TableCell>
          <TableCell>{row.partner_name ?? "—"}</TableCell>
          <TableCell className="whitespace-nowrap">{row.consultation_at ? formatHospitalDate(row.consultation_at) : "—"}</TableCell>
          <TableCell className="max-w-56 truncate" title={row.package_name ?? undefined}>{row.package_name ?? "—"}</TableCell>
          <TableCell className="text-right tabular-nums">{row.package_value_paise != null ? formatInr(Number(row.package_value_paise)) : "—"}</TableCell>
          <TableCell className="text-right tabular-nums">{row.collected_paise != null ? formatInr(Number(row.collected_paise)) : "—"}</TableCell>
          <TableCell className="whitespace-nowrap">{row.converted_at ? formatHospitalDate(row.converted_at) : "—"}</TableCell>
          <TableCell className="whitespace-nowrap text-right tabular-nums">{row.incentive_bps != null ? <>{formatBps(row.incentive_bps)}<div className="text-xs text-muted-foreground">{row.incentive_paise != null ? formatInr(Number(row.incentive_paise)) : "—"}</div></> : "—"}</TableCell>
          <TableCell><StatusBadge status={row.report_status} />{row.paid_at ? <div className="mt-1 text-xs text-muted-foreground">{formatHospitalDate(row.paid_at)}</div> : null}</TableCell>
          <TableCell className="text-right"><LeadPackageDialog row={row} /></TableCell>
        </TableRow>)}
        {!rows.length ? <TableRow><TableCell colSpan={12} className="h-28 text-center text-muted-foreground">No referrals or conversions in this range.</TableCell></TableRow> : null}
      </TableBody>
    </Table></div>
    <TablePagination page={query.page} total={Number(totals?.total_count ?? 0)} noun="conversions" params={keep} /></CardContent></Card>
    <p className="mt-3 text-xs text-muted-foreground">Amount collected = consultation payments and procedure bills recorded since conversion. Incentive = partner % of that amount, capped at the package value; it is locked when marked paid.</p>
  </>;
}

async function PartnersTable({ params }: { params: ReferralSearch }) {
  const q = (params.q ?? "").trim().slice(0, 160);
  const page = Math.min(100000, Math.max(1, Math.floor(Number(params.page)) || 1));
  const db = await createSupabaseServerClient();
  let query = db.from("referral_partners").select("id,name,organization,phone_normalized,default_incentive_bps,notes,active", { count: "exact" }).order("name").order("id").range(...rangeFor(page));
  if (q) { const pattern = containsSearchPattern(q); query = query.or(`name.ilike.${pattern},organization.ilike.${pattern},phone_normalized.ilike.${pattern}`); }
  const { data, count, error } = await query;
  if (error) throw new Error("Referral partners could not be loaded. Please retry.");
  const rows = (data ?? []) as PartnerItem[];
  return <>
    <DebouncedSearchInput className="mb-4 max-w-md" initialValue={q} placeholder="Search partner, organisation or mobile" ariaLabel="Search referral partners" />
    <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table>
      <TableHeader><TableRow><TableHead>Partner</TableHead><TableHead>Organisation</TableHead><TableHead>Mobile</TableHead><TableHead className="text-right">Default Incentive</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((row) => <TableRow key={row.id}>
          <TableCell className="font-medium">{row.name}</TableCell><TableCell>{row.organization ?? "—"}</TableCell>
          <TableCell className="tabular-nums">{row.phone_normalized ?? "—"}</TableCell><TableCell className="text-right tabular-nums">{formatBps(row.default_incentive_bps)}</TableCell>
          <TableCell><StatusBadge status={row.active ? "active" : "inactive"} /></TableCell>
          <TableCell className="text-right"><PartnerDialog item={row} /></TableCell>
        </TableRow>)}
        {!rows.length ? <TableRow><TableCell colSpan={6} className="h-28 text-center text-muted-foreground">{q ? "No partners match this search." : "No referral partners yet."}</TableCell></TableRow> : null}
      </TableBody>
    </Table></div>
    <TablePagination page={page} total={count ?? 0} noun="partners" params={{ tab: "partners", q }} /></CardContent></Card>
  </>;
}
