import { Activity, CalendarHeart, ClipboardCheck, Megaphone, PhoneCall, Clock3, IndianRupee, PackageX, UserRound, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getCurrentProfile } from "@/lib/auth/dal";
import { ROLE_LABELS } from "@/types/hospital";
import { getDashboardData } from "@/features/dashboard/data";
import { KpiCard } from "@/features/dashboard/kpi-card";
import { formatInr } from "@/lib/domain/money";
import { formatHospitalDate } from "@/lib/domain/date";
import { formatPrescriptionNumber } from "@/lib/domain/prescription";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const metricSets = {
  admin: [
    ["patients_seen_today", "Patients Seen Today", Users], ["patients_today", "New Patients Today", Users],
    ["visits_today", "OP Visits Today", UserRound],
    ["waiting", "Waiting", Clock3], ["completed", "Completed Today", UserRound],
    ["collected_today_paise", "Collected Today", IndianRupee], ["low_stock", "Low Stock", PackageX],
    ["leads_today", "New Leads Today", Megaphone], ["leads_unassigned", "Unassigned Leads", Megaphone],
    ["reports_pending", "Reports Pending", Activity],
    ["pending_prescriptions", "Pending Prescriptions", ClipboardCheck],
  ],
  reception: [
    ["patients_today", "Registrations Today", Users], ["visits_today", "Visits Today", UserRound],
    ["waiting", "Waiting", Clock3], ["vitals_pending", "Vitals Pending", Activity],
    ["ready", "Ready for Doctor", ClipboardCheck], ["completed", "Completed Today", UserRound],
    ["followups_due", "Follow-ups Due", ClipboardCheck], ["reports_ready", "Reports Ready", Activity],
    ["lead_appointments_today", "Lead Appointments", CalendarHeart], ["collected_today_paise", "Collected Today", IndianRupee],
  ],
  op: [["patients_seen_today", "Patients Today", Users], ["waiting", "Waiting", Clock3], ["vitals_pending", "Vitals Pending", Activity], ["ready", "Ready for Doctor", ClipboardCheck], ["completed", "Completed Today", UserRound], ["reports_pending", "Reports Pending", Activity]],
  doctor: [["waiting", "Waiting for Me", Clock3], ["ready", "Ready for Me", ClipboardCheck], ["completed", "Completed Today", UserRound], ["followups_due", "Follow-ups Today", Activity], ["reports_ready", "Reports to Review", ClipboardCheck]],
  sales_executive: [["leads_new", "New Leads", Megaphone], ["leads_followups_due", "Follow-ups Due", PhoneCall], ["leads_booked_today", "Appointments Today", CalendarHeart], ["leads_converted_month", "Converted This Month", UserRound], ["leads_open", "Open Leads", Users], ["leads_conversion_pct", "Conversion % (Month)", Activity]],
  pharmacy: [["pending_prescriptions", "Pending Prescriptions", ClipboardCheck], ["pharmacy_sales_today_paise", "Today's Sales", IndianRupee], ["low_stock", "Low Stock", PackageX], ["out_of_stock", "Out of Stock", PackageX], ["expiring_soon", "Expiring Soon", Clock3], ["dispensed_today", "Dispensed Today", Activity]],
} as const;

export default async function DashboardPage() {
  const profile = await getCurrentProfile();
  const { summary, activity } = await getDashboardData(profile);
  const metrics: ReadonlyArray<readonly [string, string, LucideIcon]> = metricSets[profile.role];
  return (
    <div>
      <PageHeader title={`Good day, ${profile.fullName.split(" ")[0]}`} description={`${ROLE_LABELS[profile.role]} dashboard · live clinic operations`} />
      <section className="grid grid-cols-2 gap-2.5 md:grid-cols-3 md:gap-3 2xl:grid-cols-6">
        {metrics.map(([key, label, Icon]) => {
          const value = summary[key] ?? 0;
          const isMoney = key.endsWith("_paise");
          // Currency runs long (₹90,015.00) and was being clipped to "₹90,01…".
          // Money gets a smaller step and may wrap; counts keep the large size.
          const formatted = isMoney ? formatInr(value) : new Intl.NumberFormat("en-IN").format(value);
          return (
            <KpiCard
              key={key}
              metricKey={key}
              label={label}
              value={formatted}
              isMoney={isMoney}
              icon={<Icon className="size-4" />}
            />
          );
        })}
      </section>
      <DashboardActivity activity={activity} />
    </div>
  );
}

function DashboardActivity({ activity }: { activity: Awaited<ReturnType<typeof getDashboardData>>["activity"] }) {
  if (activity.kind === "leads") return <Card className="mt-5 overflow-hidden"><CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">My next calls</CardTitle><Button size="sm" variant="outline" render={<Link href="/leads" />}>All my leads</Button></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Lead</TableHead><TableHead>Phone</TableHead><TableHead>Interest</TableHead><TableHead>Status</TableHead><TableHead>Follow-up</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{activity.rows.length ? activity.rows.map((row) => <TableRow key={row.id}><TableCell className="font-medium">{row.full_name ?? "—"}</TableCell><TableCell className="tabular-nums">{row.phone_normalized ?? "—"}</TableCell><TableCell>{row.procedure_interest ?? "—"}</TableCell><TableCell><StatusBadge status={row.status} /></TableCell><TableCell>{row.next_follow_up_at ? formatHospitalDate(row.next_follow_up_at, true) : "—"}</TableCell><TableCell className="text-right"><Button size="sm" variant="outline" render={<Link href={`/leads/${row.id}`} />}>Open</Button></TableCell></TableRow>) : <TableRow><TableCell colSpan={6} className="h-28 text-center text-muted-foreground">No open leads right now.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>;
  if (activity.kind === "pharmacy") return <Card className="mt-5 overflow-hidden"><CardHeader><CardTitle className="text-base">Pending prescriptions</CardTitle></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Token</TableHead><TableHead>Patient</TableHead><TableHead>Prescription</TableHead><TableHead>Source</TableHead><TableHead>Doctor</TableHead><TableHead>Items</TableHead><TableHead>Status</TableHead><TableHead>Time</TableHead></TableRow></TableHeader><TableBody>{activity.rows.length ? activity.rows.map((row) => <TableRow key={row.id}><TableCell className="font-medium tabular-nums">{row.token_number ? `#${row.token_number}` : "—"}</TableCell><TableCell className="font-medium">{row.patient_name ?? "—"}</TableCell><TableCell className="font-mono text-xs">{formatPrescriptionNumber(row.prescription_number)}</TableCell><TableCell className="uppercase">{row.source}</TableCell><TableCell>{row.doctor_name ?? "—"}</TableCell><TableCell>{row.items?.length ?? 0}</TableCell><TableCell><StatusBadge status={row.status} /></TableCell><TableCell>{formatHospitalDate(row.created_at, true)}</TableCell></TableRow>) : <TableRow><TableCell colSpan={8} className="h-28 text-center text-muted-foreground">No prescriptions are waiting.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>;
  return <Card className="mt-5 overflow-hidden"><CardHeader><CardTitle className="text-base">Recent visits</CardTitle></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Token</TableHead><TableHead>Patient</TableHead><TableHead>Doctor</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Time</TableHead></TableRow></TableHeader><TableBody>{activity.rows.length ? activity.rows.map((visit) => <TableRow key={visit.id}><TableCell className="font-medium">#{visit.token_number}</TableCell><TableCell>{visit.patients?.name ?? "—"}</TableCell><TableCell>{visit.doctors?.display_name ?? "—"}</TableCell><TableCell>{visit.visit_type}</TableCell><TableCell><StatusBadge status={visit.status} /></TableCell><TableCell className="whitespace-nowrap text-muted-foreground">{formatHospitalDate(visit.created_at, true)}</TableCell></TableRow>) : <TableRow><TableCell colSpan={6} className="h-28 text-center text-muted-foreground">No visits yet today.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>;
}
