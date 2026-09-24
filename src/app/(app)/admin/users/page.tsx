import { APP_ROLES, ROLE_LABELS } from "@/types/hospital";
import { requireRoute } from "@/lib/auth/dal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatHospitalDate } from "@/lib/domain/date";
import { PAGE_SIZE, TablePagination, pageFromParam, rangeFor } from "@/components/shared/table-pagination";
import { containsSearchPattern } from "@/lib/domain/search";
import { AddUserDialog, EditDoctorDialog, EditStaffDialog } from "@/features/admin/admin-dialogs";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { DebouncedSearchInput } from "@/components/shared/debounced-search-input";
import { RoleFilterSelect } from "@/components/shared/role-filter-select";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
type UserRow = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  status: string;
  doctors: { id:string;display_name:string;department_id:string|null;specialization:string|null;qualification:string|null;registration_number:string|null;op_fee_paise:number;follow_up_fee_paise:number;active:boolean } | null;
};
const STAFF_ROLES: readonly string[] = APP_ROLES;
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string; page?: string }>;
}) {
  await requireRoute("/admin/users");
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const selectedRole = STAFF_ROLES.includes(params.role ?? "") ? (params.role as string) : "";
  const page = pageFromParam(params.page);
  const admin = createSupabaseAdminClient();
  let profilesQuery = admin
    .from("profiles")
    .select(
      "id,full_name,email,role,status,doctors!profiles_doctor_id_fkey(id,display_name,department_id,specialization,qualification,registration_number,op_fee_paise,follow_up_fee_paise,active)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(...rangeFor(page));
  if (q) {
    const pattern = containsSearchPattern(q);
    const filters = [
      `full_name.ilike.${pattern}`,
      `email.ilike.${pattern}`,
    ];
    const role = q.toLowerCase().replace(/\s+/g, "_");
    if (STAFF_ROLES.includes(role)) {
      filters.push(`role.eq.${role}`);
    }
    profilesQuery = profilesQuery.or(filters.join(","));
  }
  // Dropdown filter is independent of the free-text search above -- both can
  // narrow the table at once (e.g. search "staff" within role "reception").
  if (selectedRole) profilesQuery = profilesQuery.eq("role", selectedRole);
  const [{ data: profiles, count }, { data: authData }, { data: departments }] = await Promise.all([
    profilesQuery,
    // Last sign-in comes from the auth service, which cannot be filtered to
    // this page's ids -- and asking per row would be one round trip per user.
    // One call covering every staff account is cheaper than either; a hospital
    // has one account per employee, so this is tens of rows, not thousands.
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    admin.from("departments").select("id,name").eq("active",true).order("name"),
  ]);
  const signIns = new Map(
    authData?.users.map((user) => [user.id, user.last_sign_in_at]),
  );
  const rows = (profiles ?? []) as unknown as UserRow[];
  const total = count ?? 0;
  return (
    <div>
      <PageHeader
        title="Staff Users"
        description="Authentication accounts, roles, doctor links, and access status"
        actions={
          <>
            <RoleFilterSelect roles={STAFF_ROLES} value={selectedRole} />
            <AddUserDialog />
          </>
        }
      />
      <DebouncedSearchInput className="mb-4 max-w-md" initialValue={q} placeholder="Search name, email or role" ariaLabel="Search staff users" />
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Linked Doctor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Sign-in</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      {user.full_name}
                    </TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>{(ROLE_LABELS as Record<string, string>)[user.role] ?? user.role}</TableCell>
                    <TableCell>{user.doctors?.display_name ?? "—"}</TableCell>
                    <TableCell>
                      <StatusBadge status={user.status} />
                    </TableCell>
                    <TableCell>
                      {signIns.get(user.id)
                        ? formatHospitalDate(signIns.get(user.id)!, true)
                        : "Never"}
                    </TableCell>
                    <TableCell className="text-right">
                      {user.role === "doctor" && user.doctors ? <EditDoctorDialog triggerLabel="Doctor Master" doctor={{id:user.doctors.id,displayName:user.doctors.display_name,departmentId:user.doctors.department_id??departments?.[0]?.id??"",specialization:user.doctors.specialization,qualification:user.doctors.qualification,registrationNumber:user.doctors.registration_number??"",opFee:(user.doctors.op_fee_paise/100).toFixed(2),followUpFee:(user.doctors.follow_up_fee_paise/100).toFixed(2),active:user.doctors.active}} departments={departments??[]}/> : user.role === "doctor" ? <span className="text-xs text-destructive">Doctor link missing</span> : <EditStaffDialog user={{ id: user.id, fullName: user.full_name, role: user.role, status: user.status }} />}
                    </TableCell>
                  </TableRow>
                ))}
                {!rows.length ? <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground">{q ? "No staff users match this search." : "No staff users found."}</TableCell></TableRow> : null}
              </TableBody>
            </Table>
          </div>
          <TablePagination page={page} total={total} noun="staff users" params={{ q, role: selectedRole }} size={PAGE_SIZE} />
        </CardContent>
      </Card>
    </div>
  );
}
