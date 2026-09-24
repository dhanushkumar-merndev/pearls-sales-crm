import { requireRoute } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatInr, packBreakdown, piecePricePaise } from "@/lib/domain/money";
import { stockStatus } from "@/lib/domain/stock";
import { PageHeader } from "@/components/shared/page-header";
import { DebouncedSearchInput } from "@/components/shared/debounced-search-input";
import { TablePager } from "@/components/shared/table-pager";
import { BatchDialog } from "@/features/pharmacy/medicine-dialogs";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
type Batch = {
  id: string;
  batch_number: string;
  expiry_date: string;
  quantity: number;
  units_per_pack: number;
  selling_price_paise: number;
  low_stock_threshold: number;
  purchase_price_paise: number | null;
  active: boolean;
  medicine_id: string;
  medicine_directory: {
    brand_name: string;
    generic_name: string | null;
    strength: string | null;
  } | null;
};
export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const profile = await requireRoute("/pharmacy");
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const size = 50;
  const q = params.q?.trim() ?? "";
  const supabase = await createSupabaseServerClient();
  const [{ data }, { data: medicines }] = await Promise.all([
    supabase.rpc("list_pharmacy_batches", {
      p_query: q,
      p_limit: size,
      p_offset: (page - 1) * size,
    }),
    supabase
      .from("medicine_directory")
      .select("id,brand_name,strength")
      .eq("active", true)
      .order("brand_name")
      .limit(500),
  ]);
  const source = (data ?? []) as unknown as Array<
    Omit<Batch, "medicine_directory"> & {
      brand_name: string;
      generic_name: string | null;
      strength: string | null;
      total_count: number;
    }
  >;
  const rows = source.map((row) => ({
    ...row,
    medicine_directory: {
      brand_name: row.brand_name,
      generic_name: row.generic_name,
      strength: row.strength,
    },
  }));
  const total = Number(source[0]?.total_count ?? 0);
  return (
    <div>
      <PageHeader
        title="Stock & Batches"
        description="Add physical stock, adjust batch quantities, and monitor expiry and low-stock alerts"
        actions={
          <BatchDialog
            canDelete={profile.role === "admin"}
            medicines={(medicines ?? []).map((medicine) => ({
              id: medicine.id,
              name: `${medicine.brand_name}${medicine.strength ? ` ${medicine.strength}` : ""}`,
            }))}
          />
        }
      />
      <DebouncedSearchInput
        className="mb-4 max-w-md"
        initialValue={q}
        placeholder="Search medicine, generic or batch"
        ariaLabel="Search medicine stock"
      />
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Medicine</TableHead>
                  <TableHead>Generic</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Qty (individual units)</TableHead>
                  <TableHead>Selling Price / Unit</TableHead>
                  <TableHead>Alert</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length ? (
                  rows.map((batch) => (
                    <TableRow key={batch.id}>
                      <TableCell className="font-medium">
                        {batch.medicine_directory?.brand_name}
                      </TableCell>
                      <TableCell>
                        {batch.medicine_directory?.generic_name ?? "—"}
                      </TableCell>
                      <TableCell>{batch.batch_number}</TableCell>
                      <TableCell>{batch.expiry_date}</TableCell>
                      <TableCell>
                        <span className="font-medium tabular-nums">{batch.quantity}</span>
                        {/* Stock is pieces; the pack breakdown is what the
                            pharmacist counts off the shelf. */}
                        {packBreakdown(batch.quantity, batch.units_per_pack ?? 1) ? (
                          <span className="block text-xs text-muted-foreground">
                            {packBreakdown(batch.quantity, batch.units_per_pack)!.label}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <span className="tabular-nums">
                          {formatInr(batch.selling_price_paise)}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {(batch.units_per_pack ?? 1) > 1
                            ? `per pack · ${formatInr(piecePricePaise(batch.selling_price_paise, batch.units_per_pack))} each`
                            : "per unit"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status={stockStatus(
                            batch.quantity,
                            batch.low_stock_threshold,
                          )}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <BatchDialog
                          canDelete={profile.role === "admin"}
                          medicines={[
                            {
                              id: batch.medicine_id,
                              name:
                                batch.medicine_directory?.brand_name ??
                                "Medicine",
                            },
                          ]}
                          item={{
                            id: batch.id,
                            medicineId: batch.medicine_id,
                            batchNumber: batch.batch_number,
                            expiryDate: batch.expiry_date,
                            purchasePrice: (
                              (batch.purchase_price_paise ?? 0) / 100
                            ).toFixed(2),
                            sellingPrice: (
                              batch.selling_price_paise / 100
                            ).toFixed(2),
                            lowStockThreshold: batch.low_stock_threshold,
                            unitsPerPack: batch.units_per_pack ?? 1,
                            active: batch.active,
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="h-32 text-center text-muted-foreground"
                    >
                      {q
                        ? "No stock batches match this search."
                        : "No stock batches yet. Use Add Batch to enter opening stock."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <TablePager
            page={page}
            pages={Math.max(1, Math.ceil(total / size))}
            total={total}
            params={{ q }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
