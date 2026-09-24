import Link from "next/link";
import { requireRoute } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatHospitalDate } from "@/lib/domain/date";
import { formatInr } from "@/lib/domain/money";
import { containsSearchPattern, EMPTY_UUID } from "@/lib/domain/search";
import { findMatchingVisitIds } from "@/lib/search/patients";
import { PAGE_SIZE, TablePagination, pageFromParam, rangeFor } from "@/components/shared/table-pagination";
import { PageHeader } from "@/components/shared/page-header";
import { FilterTabs } from "@/components/shared/filter-tabs";
import { DebouncedSearchInput } from "@/components/shared/debounced-search-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Payment = { id: string; created_at: string; amount_paise: number; mode: string; reference: string | null; visits: { id: string; token_number: number; patients: { name: string; phone_normalized: string } | null; doctors: { display_name: string } | null } | null; profiles: { full_name: string } | null };
type Pending = {
  visit_id: string;
  patient_id: string;
  token_number: number;
  visit_date: string;
  patient_name: string;
  patient_phone: string;
  doctor_name: string;
  fee_paise: number;
  collected_paise: number;
  balance_paise: number;
  has_prescription: boolean;
};

export default async function ReceptionPaymentsPage({ searchParams }: { searchParams: Promise<{ q?: string; view?: string; page?: string }> }) {
  await requireRoute("/reception/payments");
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const view = params.view === "collected" ? "collected" : "pending";
  const page = pageFromParam(params.page);
  const supabase = await createSupabaseServerClient();

  const header = (
    <>
      <PageHeader
        title={view === "pending" ? "Pending Consultation Fees" : "OP Payments"}
        description={
          view === "pending"
            ? "Consultations completed but not yet paid. Advice-only visits appear here too — they never reach the pharmacy."
            : "Offline collection entries are immutable and displayed newest first"
        }
      />
      <FilterTabs
        ariaLabel="Switch between pending fees and collected payments"
        active={view}
        param="view"
        params={{ q }}
        tabs={[
          { label: "Pending", value: "pending" },
          { label: "Collected", value: "collected" },
        ]}
      />
      <DebouncedSearchInput
        className="mb-4 max-w-md"
        initialValue={q}
        placeholder={view === "pending" ? "Search patient, phone or token" : "Search patient, phone, token or reference"}
        ariaLabel="Search payments"
      />
    </>
  );

  if (view === "pending") {
    const { data, error } = await supabase.rpc("list_pending_consultation_fees", {
      p_query: q || null,
      p_days: 7,
      p_limit: 100,
    });
    if (error) throw new Error("Pending consultation fees could not be loaded.");
    const rows = (data ?? []) as unknown as Pending[];
    const total = rows.reduce((sum, row) => sum + Number(row.balance_paise), 0);
    // A patient seeing two doctors has two visits and two fees. The counter
    // collects once, so the combined amount is shown against each of their rows.
    const patientTotals = new Map<string, { total: number; visits: number }>();
    for (const row of rows) {
      const entry = patientTotals.get(row.patient_id) ?? { total: 0, visits: 0 };
      entry.total += Number(row.balance_paise);
      entry.visits += 1;
      patientTotals.set(row.patient_id, entry);
    }
    return (
      <div>
        {header}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Token</TableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead>Doctor</TableHead>
                    <TableHead>Fee</TableHead>
                    <TableHead>Collected</TableHead>
                    <TableHead>Balance</TableHead>
                    <TableHead>Send To</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length ? (
                    rows.map((row) => (
                      <TableRow key={row.visit_id}>
                        <TableCell className="whitespace-nowrap">{formatHospitalDate(row.visit_date)}</TableCell>
                        <TableCell className="font-medium tabular-nums">#{row.token_number}</TableCell>
                        <TableCell>
                          <span className="font-medium">{row.patient_name}</span>
                          <span className="block text-xs text-muted-foreground">{row.patient_phone}</span>
                        </TableCell>
                        <TableCell>{row.doctor_name}</TableCell>
                        <TableCell>{formatInr(row.fee_paise)}</TableCell>
                        <TableCell>{formatInr(row.collected_paise)}</TableCell>
                        <TableCell className="font-medium">
                          {formatInr(row.balance_paise)}
                          {(patientTotals.get(row.patient_id)?.visits ?? 1) > 1 ? (
                            <span className="block text-xs font-normal text-muted-foreground">
                              {formatInr(patientTotals.get(row.patient_id)!.total)} total across{" "}
                              {patientTotals.get(row.patient_id)!.visits} doctors
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Badge variant={row.has_prescription ? "secondary" : "default"}>
                            {row.has_prescription ? "Pharmacy" : "Billing counter"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" render={<Link href={`/visits/${row.visit_id}`} />}>
                            Collect
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">
                        {q ? "No pending fees match this search." : "Every completed consultation has been paid."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {rows.length ? (
              <div className="flex justify-between border-t p-3 text-sm">
                <span className="text-muted-foreground">{rows.length} unpaid consultation{rows.length === 1 ? "" : "s"} in the last 7 days</span>
                <span className="font-medium">Total outstanding {formatInr(total)}</span>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  const visitIds = q ? await findMatchingVisitIds(supabase, q) : [];
  let query = supabase.from("visit_payments").select("id,created_at,amount_paise,mode,reference,visits(id,token_number,patients(name,phone_normalized),doctors(display_name)),profiles!visit_payments_collected_by_fkey(full_name)", { count: "exact" }).order("created_at", { ascending: false }).range(...rangeFor(page));
  if (q) query = query.or([`reference.ilike.${containsSearchPattern(q)}`, visitIds.length ? `visit_id.in.(${visitIds.join(",")})` : `visit_id.eq.${EMPTY_UUID}`].join(","));
  const { data, count } = await query;
  const rows = (data ?? []) as unknown as Payment[];
  return <div>{header}<Card><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Date/Time</TableHead><TableHead>Patient</TableHead><TableHead>Token</TableHead><TableHead>Doctor</TableHead><TableHead>Amount</TableHead><TableHead>Mode</TableHead><TableHead>Collected By</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{rows.length ? rows.map((payment) => <TableRow key={payment.id}><TableCell>{formatHospitalDate(payment.created_at, true)}</TableCell><TableCell><span className="font-medium">{payment.visits?.patients?.name}</span><span className="block text-xs text-muted-foreground">{payment.visits?.patients?.phone_normalized}</span></TableCell><TableCell>#{payment.visits?.token_number}</TableCell><TableCell>{payment.visits?.doctors?.display_name}</TableCell><TableCell>{formatInr(payment.amount_paise)}</TableCell><TableCell className="capitalize">{payment.mode.replaceAll("_", " ")}</TableCell><TableCell>{payment.profiles?.full_name ?? "—"}</TableCell><TableCell className="text-right">{payment.visits ? <Button size="sm" variant="outline" render={<Link href={`/visits/${payment.visits.id}`} />}>Open</Button> : null}</TableCell></TableRow>) : <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">{q ? "No payments match this search." : "No payments recorded."}</TableCell></TableRow>}</TableBody></Table></div><TablePagination page={page} total={count ?? 0} noun="payments" params={{ q, view }} size={PAGE_SIZE} /></CardContent></Card></div>;
}
