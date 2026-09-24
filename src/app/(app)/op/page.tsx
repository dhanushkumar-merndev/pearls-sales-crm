import Link from "next/link";
import { requireRoute } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { calculateAge } from "@/lib/domain/date";
import { ElapsedTime } from "@/components/shared/elapsed-time";
import { EMPTY_UUID, searchDigits } from "@/lib/domain/search";
import { findMatchingPatientIds } from "@/lib/search/patients";
import { DebouncedSearchInput } from "@/components/shared/debounced-search-input";
import { VitalsDialog } from "@/features/op/vitals-dialog";
import { PageHeader } from "@/components/shared/page-header";
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

type QueueRow = {
  id: string;
  token_number: number;
  created_at: string;
  status: string;
  patients: { name: string; dob: string | null; gender: string } | null;
  doctors: { display_name: string } | null;
  // vitals.visit_id is unique, so PostgREST embeds a single object (or null),
  // never an array.
  vitals: {
    weight_kg: number | null;
    height_cm: number | null;
    temperature_f: number | null;
    bp_systolic: number | null;
    bp_diastolic: number | null;
    pulse: number | null;
    spo2: number | null;
    respiratory_rate: number | null;
    notes: string | null;
  } | null;
};
export default async function OpQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireRoute("/op");
  const q = (await searchParams).q?.trim() ?? "";
  const supabase = await createSupabaseServerClient();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(new Date());
  const patientIds = q ? await findMatchingPatientIds(supabase, q) : [];
  let queueQuery = supabase
    .from("visits")
    .select(
      "id,token_number,created_at,status,patients(name,dob,gender),doctors(display_name),vitals(weight_kg,height_cm,temperature_f,bp_systolic,bp_diastolic,pulse,spo2,respiratory_rate,notes)",
    )
    .eq("visit_date", today)
    .neq("status", "cancelled")
    .order("token_number");
  if (q) {
    const filters = patientIds.length
      ? [`patient_id.in.(${patientIds.join(",")})`]
      : [`patient_id.eq.${EMPTY_UUID}`];
    if (/^#?\d{1,4}$/.test(q)) {
      filters.push(`token_number.eq.${Number(searchDigits(q))}`);
    }
    queueQuery = queueQuery.or(filters.join(","));
  }
  const { data } = await queueQuery;
  const rows = (data ?? []) as unknown as QueueRow[];
  return (
    <div>
      <PageHeader
        title="Today's OP Queue"
        description="Record vitals and move patients to the doctor queue"
      />
      <DebouncedSearchInput
        className="mb-4 max-w-md"
        initialValue={q}
        placeholder="Search token, patient name or phone"
        ariaLabel="Search today's OP queue"
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
                  <TableHead>Doctor</TableHead>
                  <TableHead>Vitals</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Waiting</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length ? (
                  rows.map((visit) => {
                    const vitals = visit.vitals;
                    const values = vitals
                      ? {
                          weight: vitals.weight_kg,
                          height: vitals.height_cm,
                          temperature: vitals.temperature_f,
                          systolic: vitals.bp_systolic,
                          diastolic: vitals.bp_diastolic,
                          pulse: vitals.pulse,
                          spo2: vitals.spo2,
                          respiratoryRate: vitals.respiratory_rate,
                          notes: vitals.notes,
                        }
                      : undefined;
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
                        <TableCell>{visit.doctors?.display_name}</TableCell>
                        <TableCell>
                          {vitals
                            ? `${vitals.bp_systolic ?? "—"}/${vitals.bp_diastolic ?? "—"} · SpO₂ ${vitals.spo2 ?? "—"}`
                            : "Pending"}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={visit.status} />
                        </TableCell>
                        <TableCell><ElapsedTime since={visit.created_at} /></TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              render={<Link href={`/visits/${visit.id}`} />}
                            >
                              Open
                            </Button>
                            {visit.status !== "completed" ? (
                              <VitalsDialog
                                visitId={visit.id}
                                patientName={visit.patients?.name ?? "Patient"}
                                initialVitals={values}
                              />
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="h-32 text-center text-muted-foreground"
                    >
                      {q
                        ? "No queue entries match this search."
                        : "No patients in today's queue."}
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
