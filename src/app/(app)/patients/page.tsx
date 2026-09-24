import Link from "next/link";
import { requireRoute } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { calculateAge, formatHospitalDate, isHospitalToday } from "@/lib/domain/date";
import { FileSpreadsheet } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { NewPatientDialog } from "@/features/patients/new-patient-dialog";
import { DebouncedSearchInput } from "@/components/shared/debounced-search-input";
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

type PatientDirectoryRow = {
  id: string;
  name: string;
  uhid: string;
  phone_normalized: string;
  dob: string | null;
  gender: string;
  status: string;
  created_at: string;
  visit_count: number;
  total_count: number;
};

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireRoute("/patients");
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const page = Math.max(
    1,
    Number(typeof params.page === "string" ? params.page : 1) || 1,
  );
  const pageSize = 20;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_patients", {
    p_query: q || null,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
    p_include_visit_count: true,
    p_active_only: false,
  });
  if (error) throw error;
  const patients = (data ?? []) as PatientDirectoryRow[];
  const count = Number(patients[0]?.total_count ?? 0);
  const pages = Math.max(1, Math.ceil((count ?? 0) / pageSize));
  return (
    <div>
      <PageHeader
        title="Patients"
        description="Search by UHID, phone or name"
        actions={
          profile.role === "admin" || profile.role === "reception" ? (
            <div className="flex flex-wrap gap-2">
              {profile.role === "admin" || profile.role === "reception" ? (
                <Button variant="outline" render={<Link href="/patients/import" />}>
                  <FileSpreadsheet /> Bulk Import
                </Button>
              ) : null}
              <NewPatientDialog />
            </div>
          ) : undefined
        }
      />
      <Card>
        <CardContent className="p-0">
          <div className="border-b p-3">
            <DebouncedSearchInput
              className="max-w-md"
              initialValue={q}
              placeholder="UHID, phone or patient name"
              ariaLabel="Search patients by UHID, phone or name"
            />
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>UHID</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Age/Gender</TableHead>
                  <TableHead>Visits</TableHead>
                  <TableHead>Registered</TableHead>
                  {/* This is the patient RECORD's status (active/inactive/archived),
                      not any one visit's workflow status -- a patient can be "Active"
                      here while their latest visit shows "Completed" in Recent Visits. */}
                  <TableHead>Record Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {patients.length ? (
                  patients.map((patient) => {
                    const age = patient.dob ? calculateAge(patient.dob) : null;
                    return (
                      <TableRow key={patient.id} historical={!isHospitalToday(patient.created_at)}>
                        <TableCell className="font-medium">
                          {patient.name}
                        </TableCell>
                        <TableCell className="font-mono text-xs font-medium">
                          {patient.uhid}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {patient.phone_normalized}
                        </TableCell>
                        <TableCell className="capitalize">
                          {age === null ? "—" : `${age} yrs`} / {patient.gender}
                        </TableCell>
                        <TableCell>{Number(patient.visit_count)}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {formatHospitalDate(patient.created_at)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={patient.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            render={<Link href={`/patients/${patient.id}`} />}
                          >
                            Open
                          </Button>
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
                        ? "No matching patients."
                        : "No patients registered yet."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between border-t p-3 text-sm text-muted-foreground">
            <span>{count ?? 0} patients</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                render={
                  page > 1 ? (
                    <Link
                      href={`?q=${encodeURIComponent(q)}&page=${page - 1}`}
                    />
                  ) : undefined
                }
              >
                Previous
              </Button>
              <span className="flex items-center px-2">
                {page} / {pages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= pages}
                render={
                  page < pages ? (
                    <Link
                      href={`?q=${encodeURIComponent(q)}&page=${page + 1}`}
                    />
                  ) : undefined
                }
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
