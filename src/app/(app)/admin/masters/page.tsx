import { requireRoute } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatInr } from "@/lib/domain/money";
import { PAGE_SIZE, TablePagination, pageFromParam, rangeFor } from "@/components/shared/table-pagination";
import { containsSearchPattern } from "@/lib/domain/search";
import {
  ChargeDialog,
  DepartmentDialog,
  ReportCategoryDialog,
} from "@/features/admin/master-dialogs";
import { PageHeader } from "@/components/shared/page-header";
import { FilterTabs } from "@/components/shared/filter-tabs";
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

const TABS = [
  { label: "Departments", value: "departments" },
  { label: "Charges", value: "charges" },
  { label: "Report Categories", value: "report-categories" },
];

const META: Record<string, { description: string; placeholder: string }> = {
  departments: {
    description:
      "Clinical departments used for doctors, visits, tokens, and printing",
    placeholder: "Search department or description",
  },
  charges: {
    description: "Clinic price list for consultations, procedures, treatments, and tests",
    placeholder: "Search charge name or category",
  },
  "report-categories": {
    description:
      "Categories available when staff uploads a private patient report",
    placeholder: "Search report category",
  },
};

function EmptyRow({ span, searched }: { span: number; searched: boolean }) {
  return (
    <TableRow>
      <TableCell
        colSpan={span}
        className="h-32 text-center text-muted-foreground"
      >
        {searched ? "No records match this search." : "No records found yet."}
      </TableCell>
    </TableRow>
  );
}

export default async function MastersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; page?: string }>;
}) {
  await requireRoute("/admin/masters");
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const page = pageFromParam(params.page);
  const tab = TABS.some((entry) => entry.value === params.tab)
    ? params.tab!
    : "departments";
  const supabase = await createSupabaseServerClient();
  const pattern = containsSearchPattern(q);

  return (
    <div>
      <PageHeader
        title="Masters"
        description={META[tab].description}
        actions={
          tab === "departments" ? (
            <DepartmentDialog />
          ) : tab === "charges" ? (
            <ChargeDialog />
          ) : (
            <ReportCategoryDialog />
          )
        }
      />
      <FilterTabs
        ariaLabel="Select master data table"
        active={tab}
        param="tab"
        params={{ q }}
        tabs={TABS}
      />
      <DebouncedSearchInput
        className="mb-4 max-w-md"
        initialValue={q}
        placeholder={META[tab].placeholder}
        ariaLabel={META[tab].placeholder}
      />
      <Card>
        <CardContent className="p-0">
          <div>
            {tab === "departments" ? (
              <DepartmentsTable supabase={supabase} q={q} pattern={pattern} page={page} tab={tab} />
            ) : tab === "charges" ? (
              <ChargesTable supabase={supabase} q={q} pattern={pattern} page={page} tab={tab} />
            ) : (
              <ReportCategoriesTable
                supabase={supabase}
                q={q}
                pattern={pattern}
                page={page}
                tab={tab}
              />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

type TableProps = {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  q: string;
  pattern: string;
  page: number;
  tab: string;
};

/** Scroll wrapper plus the page footer every master table shares. */
function TableShell({
  children, page, total, noun, q, tab,
}: {
  children: React.ReactNode; page: number; total: number; noun: string; q: string; tab: string;
}) {
  return (
    <>
      <div className="overflow-x-auto">{children}</div>
      <TablePagination page={page} total={total} noun={noun} params={{ q, tab }} size={PAGE_SIZE} />
    </>
  );
}

async function DepartmentsTable({ supabase, q, pattern, page, tab }: TableProps) {
  let query = supabase
    .from("departments")
    .select("id,name,description,active", { count: "exact" })
    .order("name")
    .range(...rangeFor(page));
  if (q) query = query.or(`name.ilike.${pattern},description.ilike.${pattern}`);
  const { data, count } = await query;
  const rows = data ?? [];
  return (
    <TableShell page={page} total={count ?? 0} noun="departments" q={q} tab={tab}>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Department</TableHead>
          <TableHead>Description</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="font-medium">{item.name}</TableCell>
            <TableCell>{item.description ?? "—"}</TableCell>
            <TableCell>
              <StatusBadge status={item.active ? "active" : "inactive"} />
            </TableCell>
            <TableCell className="text-right">
              <DepartmentDialog item={item} />
            </TableCell>
          </TableRow>
        ))}
        {rows.length ? null : <EmptyRow span={4} searched={Boolean(q)} />}
      </TableBody>
    </Table>
    </TableShell>
  );
}

async function ChargesTable({ supabase, q, pattern, page, tab }: TableProps) {
  let query = supabase
    .from("charges")
    .select("id,category,charge_name,amount_paise,active", { count: "exact" })
    .order("category")
    .order("charge_name")
    .range(...rangeFor(page));
  if (q)
    query = query.or(`category.ilike.${pattern},charge_name.ilike.${pattern}`);
  const { data, count } = await query;
  const rows = data ?? [];
  return (
    <TableShell page={page} total={count ?? 0} noun="charges" q={q} tab={tab}>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Category</TableHead>
          <TableHead>Charge Name</TableHead>
          <TableHead>Amount</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((item) => (
          <TableRow key={item.id}>
            <TableCell>{item.category}</TableCell>
            <TableCell className="font-medium">{item.charge_name}</TableCell>
            <TableCell>{formatInr(item.amount_paise)}</TableCell>
            <TableCell>
              <StatusBadge status={item.active ? "active" : "inactive"} />
            </TableCell>
            <TableCell className="text-right">
              <ChargeDialog
                item={{
                  id: item.id,
                  category: item.category,
                  name: item.charge_name,
                  amount: (item.amount_paise / 100).toFixed(2),
                  active: item.active,
                }}
              />
            </TableCell>
          </TableRow>
        ))}
        {rows.length ? null : <EmptyRow span={5} searched={Boolean(q)} />}
      </TableBody>
    </Table>
    </TableShell>
  );
}

async function ReportCategoriesTable({ supabase, q, pattern, page, tab }: TableProps) {
  let query = supabase
    .from("report_categories")
    .select("id,name,active,created_at", { count: "exact" })
    .order("name")
    .range(...rangeFor(page));
  if (q) query = query.ilike("name", pattern);
  const { data, count } = await query;
  const rows = data ?? [];
  return (
    <TableShell page={page} total={count ?? 0} noun="report categories" q={q} tab={tab}>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Category</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="font-medium">{item.name}</TableCell>
            <TableCell>
              <StatusBadge status={item.active ? "active" : "inactive"} />
            </TableCell>
            <TableCell className="text-right">
              <ReportCategoryDialog item={item} />
            </TableCell>
          </TableRow>
        ))}
        {rows.length ? null : <EmptyRow span={3} searched={Boolean(q)} />}
      </TableBody>
    </Table>
    </TableShell>
  );
}
