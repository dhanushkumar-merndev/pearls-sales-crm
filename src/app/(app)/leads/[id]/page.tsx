import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRoute } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { databaseIdSchema } from "@/lib/validation/database-id";
import { formatHospitalDate } from "@/lib/domain/date";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { TablePagination, rangeFor } from "@/components/shared/table-pagination";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { LeadForms } from "@/features/leads/forms";
import type { Lead, Owner, PatientMatch } from "@/features/leads/schema";
import { LeadPartnerForm } from "@/features/referrals/forms";
import type { PartnerOption } from "@/features/referrals/schema";

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const profile = await requireRoute("/leads");
  const { id } = await params;
  if (!databaseIdSchema.safeParse(id).success) notFound();
  const page = Math.max(1, Math.min(100000, Math.floor(Number((await searchParams).page)) || 1));
  const db = await createSupabaseServerClient();
  const result = await db.from("leads").select("id,full_name,phone_raw,phone_normalized,email,city,procedure_interest,message,source,status,assigned_to,lost_reason,next_follow_up_at,appointment_at,received_at,patient_id,converted_visit_id,meta_form_name,referral_partner_id").eq("id", id).maybeSingle();
  if (result.error) throw new Error("Could not load the enquiry. Please retry.");
  if (!result.data) notFound();
  const lead = result.data as Lead;
  const [activity, matches, owners, partners] = await Promise.all([
    db.from("lead_activities").select("id,type,body,from_status,to_status,created_at", { count: "exact" }).eq("lead_id", id).order("created_at", { ascending: false }).order("id").range(...rangeFor(page)),
    db.rpc("find_lead_patient_matches", { p_lead_id: id }),
    profile.role === "admin" ? db.from("profiles").select("id,full_name").eq("role", "sales_executive").eq("status", "active").order("full_name").limit(100) : Promise.resolve({ data: [], error: null }),
    db.rpc("list_referral_partner_options"),
  ]);
  if (activity.error || matches.error || owners.error || partners.error) throw new Error("Could not load enquiry details. Please retry.");
  const partnerOptions = (partners.data ?? []) as PartnerOption[];
  return <div className="space-y-4"><PageHeader title={lead.full_name ?? "Enquiry"} description={`${lead.phone_normalized ?? lead.phone_raw ?? "No mobile"} · ${lead.procedure_interest ?? "General enquiry"}`} actions={<Button variant="outline" render={<Link href="/leads" />}>Back to leads</Button>} />
    <Card><CardContent className="space-y-3 pt-5"><div className="flex flex-wrap items-center gap-3"><StatusBadge status={lead.status} /><span className="text-sm text-muted-foreground">Received {formatHospitalDate(lead.received_at, true)} · {lead.meta_form_name ?? lead.source}</span></div>
      <div className="grid gap-3 text-sm sm:grid-cols-2"><p>Email: {lead.email ?? "—"}</p><p>City: {lead.city ?? "—"}</p><p>Follow-up: {lead.next_follow_up_at ? formatHospitalDate(lead.next_follow_up_at, true) : "—"}</p><p>Appointment: {lead.appointment_at ? formatHospitalDate(lead.appointment_at, true) : "—"}</p>{lead.referral_partner_id ? <p>Referred by: {partnerOptions.find((p) => p.id === lead.referral_partner_id)?.name ?? "Inactive partner"}</p> : null}</div>
      {lead.message ? <p className="whitespace-pre-wrap break-words text-sm">{lead.message}</p> : null}{lead.lost_reason ? <p className="text-sm">Lost reason: {lead.lost_reason}</p> : null}
      {profile.role === "admin" && lead.patient_id ? <Button size="sm" variant="outline" render={<Link href={`/patients/${lead.patient_id}`} />}>Open patient</Button> : null}
    </CardContent></Card>
    {profile.role === "admin" ? <Card><CardHeader><CardTitle className="text-base">Referral partner</CardTitle></CardHeader><CardContent><LeadPartnerForm key={lead.referral_partner_id ?? "none"} leadId={lead.id} partnerId={lead.referral_partner_id ?? null} partners={partnerOptions} /><p className="mt-3 text-xs text-muted-foreground">Package value and incentive are managed in <Link href="/admin/referrals" className="underline">Referrals</Link>.</p></CardContent></Card> : null}
    <LeadForms key={`${lead.id}-${lead.status}-${lead.assigned_to}`} lead={lead} owners={(owners.data ?? []) as Owner[]} matches={(matches.data ?? []) as PatientMatch[]} isAdmin={profile.role === "admin"} />
    <Card><CardHeader><CardTitle className="text-base">Activity history</CardTitle></CardHeader><CardContent className="space-y-4">{activity.data?.map((row) => <div key={row.id} className="space-y-1 border-b pb-3 last:border-0"><div className="flex flex-wrap gap-2 text-sm"><span className="font-medium capitalize">{row.type.replaceAll("_", " ")}</span><span className="text-muted-foreground">{formatHospitalDate(row.created_at, true)}</span>{row.to_status ? <StatusBadge status={row.to_status} /> : null}</div><p className="whitespace-pre-wrap break-words text-sm">{row.body ?? "Status updated"}</p></div>)}{!activity.data?.length ? <p className="text-sm text-muted-foreground">No activity yet.</p> : null}</CardContent><TablePagination page={page} total={activity.count ?? 0} noun="activities" /></Card>
  </div>;
}
