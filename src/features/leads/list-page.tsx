import Link from "next/link";
import { requireRoute } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prefixSearchPattern } from "@/lib/domain/search";
import { formatHospitalDate } from "@/lib/domain/date";
import { databaseIdSchema } from "@/lib/validation/database-id";
import { PageHeader } from "@/components/shared/page-header";
import { DebouncedSearchInput } from "@/components/shared/debounced-search-input";
import { StatusBadge } from "@/components/shared/status-badge";
import { TablePagination, rangeFor } from "@/components/shared/table-pagination";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from "@/components/ui/table";
import { LEAD_STATUSES, type Lead, type Owner } from "./schema";
import { NewLeadDialog } from "./forms";
import { LeadFilters } from "./list-filters";

export type LeadSearch = { q?: string; status?: string; owner?: string; source?: string; page?: string };
export async function LeadListPage({ searchParams, mode = "all" }: { searchParams: Promise<LeadSearch>; mode?: "all" | "due" | "booked" }) {
  const profile = await requireRoute("/leads");
  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 160);
  const page = Math.min(100000, Math.max(1, Math.floor(Number(params.page)) || 1));
  const db = await createSupabaseServerClient();
  let query = db.from("leads").select("id,full_name,phone_raw,phone_normalized,procedure_interest,source,status,assigned_to,next_follow_up_at,appointment_at,received_at", { count: "exact" });
  if (mode === "due") query = query.lte("next_follow_up_at", new Date().toISOString()).not("status", "in", "(converted,lost)").order("next_follow_up_at");
  else if (mode === "booked") query = query.eq("status", "booked").order("appointment_at");
  else query = query.order("received_at", { ascending: false });
  if (mode === "all" && LEAD_STATUSES.includes(params.status as Lead["status"])) query = query.eq("status", params.status!);
  if (params.source === "manual" || params.source === "meta") query = query.eq("source", params.source);
  if (profile.role === "admin" && params.owner === "unassigned") query = query.is("assigned_to", null);
  else if (profile.role === "admin" && databaseIdSchema.safeParse(params.owner).success) query = query.eq("assigned_to", params.owner!);
  if (q) { const pattern = prefixSearchPattern(q.toLowerCase()); query = query.or(`name_search.like.${pattern},phone_normalized.like.${pattern}`); }
  const [result, ownersResult] = await Promise.all([query.order("id").range(...rangeFor(page)), profile.role === "admin" ? db.from("profiles").select("id,full_name").eq("role", "sales_executive").eq("status", "active").order("full_name").limit(100) : Promise.resolve({ data: [], error: null })]);
  if (result.error || ownersResult.error) throw new Error("Leads could not be loaded. Please try again.");
  const rows = (result.data ?? []) as Lead[];
  const owners = (ownersResult.data ?? []) as Owner[];
  const names = new Map(owners.map((owner) => [owner.id, owner.full_name]));
  const title = mode === "due" ? "Follow-ups due" : mode === "booked" ? "Booked appointments" : profile.role === "admin" ? "Leads" : "My leads";
  return <div><PageHeader title={title} description="Enquiries, calls and appointments in one place" actions={<NewLeadDialog owners={owners} />} />
    <div className="mb-4 flex flex-wrap gap-2"><Button variant={mode === "all" ? "default" : "outline"} render={<Link href="/leads" />}>All leads</Button><Button variant={mode === "due" ? "default" : "outline"} render={<Link href="/leads/follow-ups" />}>Follow-ups due</Button><Button variant={mode === "booked" ? "default" : "outline"} render={<Link href="/leads/booked" />}>Booked</Button></div>
    <div className="mb-4 flex flex-wrap gap-3"><DebouncedSearchInput initialValue={q} placeholder="Search name or mobile" ariaLabel="Search leads" delay={250} className="min-w-48 flex-1" /><LeadFilters status={params.status} source={params.source} owner={params.owner} owners={owners} showStatus={mode === "all"} isAdmin={profile.role === "admin"} /></div>
    <Card><CardContent className="p-0"><Table><TableHeader><TableRow>{["Name", "Mobile", "Interest", "Source", "Status", ...(profile.role === "admin" ? ["Assigned to"] : []), mode === "booked" ? "Appointment" : "Follow-up", "Action"].map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row.id}>
      <TableCell className="font-medium">{row.full_name ?? "Unnamed enquiry"}</TableCell><TableCell className="tabular-nums">{row.phone_normalized ?? row.phone_raw ?? "—"}</TableCell><TableCell>{row.procedure_interest ?? "—"}</TableCell><TableCell className="capitalize">{row.source}</TableCell><TableCell><StatusBadge status={row.status} /></TableCell>{profile.role === "admin" ? <TableCell>{row.assigned_to ? names.get(row.assigned_to) ?? "Inactive executive" : "Unassigned"}</TableCell> : null}
      <TableCell className="whitespace-nowrap">{(mode === "booked" ? row.appointment_at : row.next_follow_up_at) ? formatHospitalDate((mode === "booked" ? row.appointment_at : row.next_follow_up_at)!, true) : "—"}</TableCell><TableCell><Button size="sm" variant="outline" render={<Link href={`/leads/${row.id}`} />}>Open</Button></TableCell>
    </TableRow>)}{!rows.length ? <TableRow><TableCell colSpan={profile.role === "admin" ? 8 : 7} className="h-28 text-center text-muted-foreground">No leads match these filters.</TableCell></TableRow> : null}</TableBody></Table><TablePagination page={page} total={result.count ?? 0} noun="leads" params={{ q, status: params.status, owner: params.owner, source: params.source }} /></CardContent></Card>
  </div>;
}
