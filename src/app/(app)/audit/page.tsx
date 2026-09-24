import { requireRoute } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatHospitalDate, isHospitalToday } from "@/lib/domain/date";
import { containsSearchPattern } from "@/lib/domain/search";
import { PageHeader } from "@/components/shared/page-header";
import { DebouncedSearchInput } from "@/components/shared/debounced-search-input";
import { TablePager } from "@/components/shared/table-pager";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
type Audit = {
  id: number;
  created_at: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  profiles: { full_name: string } | null;
};
export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string; q?: string }> }) {
  await requireRoute("/audit");
  const params = await searchParams; const page = Math.max(1, Number(params.page) || 1); const size = 50; const q = params.q?.trim() ?? "";
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("audit_logs")
    .select("id,created_at,action,entity_type,entity_id,profiles(full_name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * size, page * size - 1);
  if (q) { const pattern = containsSearchPattern(q); query = query.or(`action.ilike.${pattern},entity_type.ilike.${pattern}`); }
  const { data, count } = await query;
  const rows = (data ?? []) as unknown as Audit[];
  return (
    <div>
      <PageHeader
        title="Audit Logs"
        description="Identifiers and action metadata only; clinical content is not copied into logs"
      />
      <DebouncedSearchInput className="mb-4 max-w-md" initialValue={q} placeholder="Search action or entity type" ariaLabel="Search audit logs" />
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((log) => (
                <TableRow key={log.id} historical={!isHospitalToday(log.created_at)}>
                  <TableCell>
                    {formatHospitalDate(log.created_at, true)}
                  </TableCell>
                  <TableCell>{log.profiles?.full_name ?? "System"}</TableCell>
                  <TableCell className="font-medium">{log.action}</TableCell>
                  <TableCell>{log.entity_type ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {log.entity_id ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
              {!rows.length ? <TableRow><TableCell colSpan={5} className="h-32 text-center text-muted-foreground">{q ? "No audit logs match this search." : "No audit logs found."}</TableCell></TableRow> : null}
            </TableBody>
          </Table>
          </div>
          <TablePager page={page} pages={Math.max(1, Math.ceil((count ?? 0) / size))} total={count ?? 0} params={{ q }} />
        </CardContent>
      </Card>
    </div>
  );
}
