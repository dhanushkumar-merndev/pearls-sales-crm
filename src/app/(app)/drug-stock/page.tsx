import { requireRoute } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
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

type Medicine = {
  id: string;
  brand_name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string;
  active: boolean;
  available_quantity: number;
  total_count: number;
};

/**
 * Read-only stock check for whoever is about to write a prescription --
 * name, form and what's actually available, nothing a pharmacist manages
 * (no price, no batch/supplier detail, no edit actions). Stock management
 * itself stays under /pharmacy.
 */
export default async function DrugStockPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requireRoute("/drug-stock");
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const page = Math.max(1, Number(params.page) || 1);
  const size = 30;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("list_medicine_directory", {
    p_query: q,
    p_limit: size,
    p_offset: (page - 1) * size,
  });
  const rows = ((data ?? []) as unknown as Medicine[]).filter((m) => m.active);
  const count = Number(rows[0]?.total_count ?? 0);
  const pages = Math.max(1, Math.ceil(count / size));

  return (
    <div>
      <PageHeader
        title="Drug Stock"
        description="What the pharmacy currently has available, for reference before prescribing."
      />
      <DebouncedSearchInput
        className="mb-4 max-w-md"
        initialValue={q}
        placeholder="Search medicine or generic name"
        ariaLabel="Search drug stock"
      />
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Medicine</TableHead>
                  <TableHead>Generic</TableHead>
                  <TableHead>Strength</TableHead>
                  <TableHead>Form</TableHead>
                  <TableHead>Available</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length ? (
                  rows.map((medicine) => (
                    <TableRow key={medicine.id}>
                      <TableCell className="font-medium">{medicine.brand_name}</TableCell>
                      <TableCell className="text-muted-foreground">{medicine.generic_name ?? "—"}</TableCell>
                      <TableCell>{medicine.strength ?? "—"}</TableCell>
                      <TableCell>{medicine.dosage_form}</TableCell>
                      <TableCell className="tabular-nums">{medicine.available_quantity}</TableCell>
                      <TableCell>
                        <StatusBadge status={medicine.available_quantity > 0 ? "in_stock" : "out_of_stock"} />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                      {q ? "No medicine matches this search." : "No medicines in the directory yet."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <TablePager page={page} pages={pages} total={count} params={{ q }} />
    </div>
  );
}
