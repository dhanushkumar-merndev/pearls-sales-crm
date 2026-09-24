import Link from "next/link";
import { requireRoute } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { calculateAge } from "@/lib/domain/date";
import { EMPTY_UUID, searchDigits } from "@/lib/domain/search";
import { findMatchingPatientIds } from "@/lib/search/patients";
import { DebouncedSearchInput } from "@/components/shared/debounced-search-input";
import { PageHeader } from "@/components/shared/page-header";
import { FilterTabs } from "@/components/shared/filter-tabs";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type DoctorQueue = {
  id: string;
  token_number: number;
  created_at: string;
  visit_type: string;
  status: string;
  patients: { name: string; dob: string | null; gender: string } | null;
  // vitals.visit_id is unique, so PostgREST embeds it as a single object (or
  // null), never an array -- same as consultations/prescriptions everywhere
  // else in the app.
  vitals: {
    bp_systolic: number | null;
    bp_diastolic: number | null;
    temperature_f: number | null;
    spo2: number | null;
  } | null;
};
export default async function DoctorQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const profile = await requireRoute("/doctor");
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const selectedStatus = params.status ?? "waiting";
  const supabase = await createSupabaseServerClient();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(new Date());
  const WAITING_STATUSES = [
    "ready",
    "in_consultation",
    "waiting",
    "vitals_pending",
  ];
  let query = supabase
    .from("visits")
    .select(
      "id,token_number,created_at,visit_type,status,patients(name,dob,gender),vitals(bp_systolic,bp_diastolic,temperature_f,spo2)",
    )
    .eq("visit_date", today)
    .order("token_number");
  if (selectedStatus === "waiting") query = query.in("status", WAITING_STATUSES);
  else if (selectedStatus === "completed")
    query = query.eq("status", "completed");
  else query = query.in("status", [...WAITING_STATUSES, "completed"]);
  if (profile.doctorId) query = query.eq("doctor_id", profile.doctorId);
  if (q) {
    const patientIds = await findMatchingPatientIds(supabase, q);
    const filters = patientIds.length
      ? [`patient_id.in.(${patientIds.join(",")})`]
      : [`patient_id.eq.${EMPTY_UUID}`];
    if (/^#?\d{1,4}$/.test(q)) {
      filters.push(`token_number.eq.${Number(searchDigits(q))}`);
    }
    query = query.or(filters.join(","));
  }
  const { data } = await query;
  const rows = (data ?? []) as unknown as DoctorQueue[];
  return (
    <div>
      <PageHeader
        title="Today OP"
        description="Patients assigned to you today"
        actions={
          <FilterTabs
            ariaLabel="Filter today's OP patients by status"
            active={selectedStatus}
            params={{ q }}
            tabs={[
              { label: "Waiting", value: "waiting" },
              { label: "Completed", value: "completed" },
              { label: "All", value: "all" },
            ]}
            className="mb-0"
          />
        }
      />
      <DebouncedSearchInput
        className="mb-4 max-w-md"
        initialValue={q}
        placeholder="Search token, patient name or phone"
        ariaLabel="Search my doctor queue"
      />
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Token</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Age/Gender</TableHead>
                  <TableHead>Visit Type</TableHead>
                  <TableHead>Vitals</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length ? (
                  rows.map((visit) => {
                    const v = visit.vitals;
                    return (
                      <TableRow key={visit.id}>
                        <TableCell className="text-lg font-semibold">
                          #{visit.token_number}
                        </TableCell>
                        <TableCell className="font-medium">
                          {visit.patients?.name}
                        </TableCell>
                        <TableCell className="capitalize">
                          {visit.patients?.dob
                            ? `${calculateAge(visit.patients.dob)} yrs`
                            : "—"}{" "}
                          / {visit.patients?.gender}
                        </TableCell>
                        <TableCell className="capitalize">
                          {visit.visit_type.replaceAll("_", " ")}
                        </TableCell>
                        <TableCell>
                          {v
                            ? `BP ${v.bp_systolic ?? "—"}/${v.bp_diastolic ?? "—"} · ${v.temperature_f ?? "—"}°F`
                            : "Pending"}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={visit.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            render={<Link href={`/visits/${visit.id}`} />}
                            size="sm"
                          >
                            {visit.status === "in_consultation"
                              ? "Continue"
                              : "Consult"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="h-32 text-center text-muted-foreground"
                    >
                      {q ? "No queue entries match this search." : "Your queue is clear."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
