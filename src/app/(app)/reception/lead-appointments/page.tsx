import Link from "next/link";
import { requireRoute } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatHospitalDate } from "@/lib/domain/date";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { TablePagination, rangeFor } from "@/components/shared/table-pagination";
import { CreateVisitDialog } from "@/features/visits/create-visit-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from "@/components/ui/table";

type Appointment = { lead_id: string; full_name: string; phone_normalized: string; procedure_interest: string | null; appointment_at: string; status: string; patient_id: string; patient_name: string; patient_uhid: string; sales_executive: string | null; converted_visit_id: string | null };
export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<{ date?: string; page?: string }> }) {
  await requireRoute("/reception/lead-appointments");
  const params = await searchParams;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const rawDate = params.date ?? "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && Number.isFinite(new Date(rawDate).getTime()) && new Date(rawDate).toISOString().slice(0, 10) === rawDate ? rawDate : today;
  const page = Math.max(1, Math.min(100000, Math.floor(Number(params.page)) || 1));
  const db = await createSupabaseServerClient();
  const [appointments, doctorsResult] = await Promise.all([
    db.rpc("list_lead_appointments", { p_date: date }, { count: "exact" }).range(...rangeFor(page)),
    db.from("doctors").select("id,display_name,op_fee_paise,follow_up_fee_paise,departments(name)").eq("active", true).order("display_name").limit(100),
  ]);
  if (appointments.error || doctorsResult.error) throw new Error("Appointments could not be loaded. Please retry.");
  const rows = (appointments.data ?? []) as Appointment[];
  const doctors = ((doctorsResult.data ?? []) as unknown as { id: string; display_name: string; op_fee_paise: number; follow_up_fee_paise: number; departments: { name: string } | null }[]).map((d) => ({ id: d.id, displayName: d.display_name, department: d.departments?.name ?? "", opFeePaise: d.op_fee_paise, followUpFeePaise: d.follow_up_fee_paise }));
  return <div><PageHeader title="Lead appointments" description="Create a visit when a booked patient arrives. Times are in IST." />
    <form className="mb-4 flex flex-wrap items-end gap-3"><div className="space-y-1"><Label htmlFor="appointment-day">Appointment date</Label><Input id="appointment-day" name="date" type="date" defaultValue={date} /></div><Button type="submit" variant="outline">Show appointments</Button></form>
    <Card><CardContent className="p-0"><Table><TableHeader><TableRow>{["Time", "Patient", "Patient ID", "Mobile", "Interest", "Sales executive", "Status", "Action"].map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row.lead_id}><TableCell className="whitespace-nowrap">{formatHospitalDate(row.appointment_at, true)}</TableCell><TableCell className="font-medium"><Link href={`/patients/${row.patient_id}`}>{row.patient_name}</Link></TableCell><TableCell>{row.patient_uhid}</TableCell><TableCell>{row.phone_normalized}</TableCell><TableCell>{row.procedure_interest ?? "—"}</TableCell><TableCell>{row.sales_executive ?? "—"}</TableCell><TableCell><StatusBadge status={row.status} /></TableCell><TableCell>{<CreateVisitDialog patientId={row.patient_id} patientName={row.patient_name} doctors={doctors} previousVisits={[]} existingVisitId={row.converted_visit_id} />}</TableCell></TableRow>)}{!rows.length ? <TableRow><TableCell colSpan={8} className="h-28 text-center text-muted-foreground">No appointments on this date.</TableCell></TableRow> : null}</TableBody></Table><TablePagination page={page} total={appointments.count ?? 0} noun="appointments" params={{ date }} /></CardContent></Card>
  </div>;
}
