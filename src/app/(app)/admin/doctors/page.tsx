import { requireRoute } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatInr } from "@/lib/domain/money";
import { PAGE_SIZE, TablePagination, pageFromParam, rangeFor } from "@/components/shared/table-pagination";
import { containsSearchPattern } from "@/lib/domain/search";
import { AddDoctorDialog, EditDoctorDialog } from "@/features/admin/admin-dialogs";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { DebouncedSearchInput } from "@/components/shared/debounced-search-input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
type Doctor = {
  id: string;
  display_name: string;
  specialization: string | null;
  qualification: string | null;
  registration_number: string | null;
  department_id: string | null;
  op_fee_paise: number;
  follow_up_fee_paise: number;
  active: boolean;
  departments: { name: string } | null;
};
export default async function DoctorsAdminPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await requireRoute("/admin/doctors");
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const page = pageFromParam(params.page);
  const supabase = await createSupabaseServerClient();
  let doctorsQuery = supabase
    .from("doctors")
    .select(
      "id,display_name,department_id,specialization,qualification,registration_number,op_fee_paise,follow_up_fee_paise,active,departments(name)",
      { count: "exact" },
    )
    .order("display_name")
    .range(...rangeFor(page));
  if (q) {
    const pattern = containsSearchPattern(q);
    doctorsQuery = doctorsQuery.or(`display_name.ilike.${pattern},specialization.ilike.${pattern},qualification.ilike.${pattern},registration_number.ilike.${pattern}`);
  }
  const [doctorResult, departmentResult] = await Promise.all([
    doctorsQuery,
    supabase
      .from("departments")
      .select("id,name")
      .eq("active", true)
      .order("name"),
  ]);
  const rows = (doctorResult.data ?? []) as unknown as Doctor[];
  const total = doctorResult.count ?? 0;
  return (
    <div>
      <PageHeader
        title="Doctors"
        description="Doctor accounts, departments, fees, and availability"
        actions={<AddDoctorDialog departments={departmentResult.data ?? []} />}
      />
      <DebouncedSearchInput className="mb-4 max-w-md" initialValue={q} placeholder="Search doctor, specialization or registration" ariaLabel="Search doctors" />
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Doctor</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Specialization</TableHead>
                  <TableHead>OP Fee</TableHead>
                  <TableHead>Follow-up Fee</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((doctor) => (
                  <TableRow key={doctor.id}>
                    <TableCell className="font-medium">
                      {doctor.display_name}
                    </TableCell>
                    <TableCell>{doctor.departments?.name ?? "—"}</TableCell>
                    <TableCell>{doctor.specialization ?? "—"}</TableCell>
                    <TableCell>{formatInr(doctor.op_fee_paise)}</TableCell>
                    <TableCell>
                      {formatInr(doctor.follow_up_fee_paise)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        status={doctor.active ? "active" : "inactive"}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <EditDoctorDialog
                        doctor={{ id: doctor.id, displayName: doctor.display_name, departmentId: doctor.department_id ?? departmentResult.data?.[0]?.id ?? "", specialization: doctor.specialization, qualification: doctor.qualification, registrationNumber: doctor.registration_number ?? "", opFee: (doctor.op_fee_paise / 100).toFixed(2), followUpFee: (doctor.follow_up_fee_paise / 100).toFixed(2), active: doctor.active }}
                        departments={departmentResult.data ?? []}
                      />
                    </TableCell>
                  </TableRow>
                ))}
                {!rows.length ? <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">{q ? "No doctors match this search." : "No doctors found."}</TableCell></TableRow> : null}
              </TableBody>
            </Table>
          </div>
          <TablePagination page={page} total={total} noun="doctors" params={{ q }} size={PAGE_SIZE} />
        </CardContent>
      </Card>
    </div>
  );
}
