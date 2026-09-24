import Link from "next/link";
import { Printer } from "lucide-react";
import { requireRoute } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatHospitalDate } from "@/lib/domain/date";
import { formatInr } from "@/lib/domain/money";
import {
  InventoryItemDialog,
  ProcedureBillDialog,
  type InventoryItem,
} from "@/features/pharmacy/inventory-dialogs";
import { PAGE_SIZE, TablePagination, pageFromParam } from "@/components/shared/table-pagination";
import { PageHeader } from "@/components/shared/page-header";
import { FilterTabs } from "@/components/shared/filter-tabs";
import { StatusBadge } from "@/components/shared/status-badge";
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

type Sale = {
  id: string;
  sale_number: number;
  procedure_name: string;
  procedure_fee_paise: number;
  items_total_paise: number;
  total_paise: number;
  payment_mode: string | null;
  created_at: string;
  patient_name: string | null;
  patient_uhid: string | null;
  doctor_name: string | null;
};

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; page?: string }>;
}) {
  await requireRoute("/pharmacy");
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const tab = params.tab === "bills" ? "bills" : "stock";
  const page = pageFromParam(params.page);
  const offset = (page - 1) * PAGE_SIZE;
  const supabase = await createSupabaseServerClient();

  const [itemsResult, doctorsResult, salesResult] = await Promise.all([
    supabase.rpc("search_inventory_items", {
      p_query: tab === "stock" ? q || null : null,
      p_limit: PAGE_SIZE,
      p_offset: tab === "stock" ? offset : 0,
    }),
    supabase.from("doctors").select("id,display_name").eq("active", true).order("display_name"),
    tab === "bills"
      ? supabase.rpc("list_procedure_sales", { p_query: null, p_limit: PAGE_SIZE, p_offset: offset })
      : Promise.resolve({ data: [] }),
  ]);

  const items = (itemsResult.data ?? []) as unknown as InventoryItem[];
  const doctors = (doctorsResult.data ?? []).map((d) => ({ id: d.id, label: d.display_name }));
  const sales = (salesResult.data ?? []) as unknown as Sale[];
  const totalOf = (rows: Array<{ total_count?: number }>) => Number(rows[0]?.total_count ?? 0);
  const total = tab === "bills"
    ? totalOf(sales as unknown as Array<{ total_count?: number }>)
    : totalOf(items as unknown as Array<{ total_count?: number }>);

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Consumables such as sutures, gauze and dressing material, and the procedure bills that use them"
        actions={
          <>
            <FilterTabs
              ariaLabel="Switch between inventory stock and procedure bills"
              active={tab}
              param="tab"
              params={{ q }}
              tabs={[
                { label: "Stock", value: "stock" },
                { label: "Procedure Bills", value: "bills" },
              ]}
              className="mb-0"
            />
            <InventoryItemDialog />
            <ProcedureBillDialog items={items} doctors={doctors} />
          </>
        }
      />
      {tab === "stock" ? (
        <>
          <DebouncedSearchInput
            className="mb-4 max-w-md"
            initialValue={q}
            placeholder="Search inventory item"
            ariaLabel="Search inventory items"
          />
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>S. No</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Expiry</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.length ? (
                      items.map((item) => {
                        const status =
                          item.quantity === 0
                            ? "out_of_stock"
                            : item.quantity <= item.low_stock_threshold
                              ? "low_stock"
                              : "in_stock";
                        return (
                          <TableRow key={item.id}>
                            <TableCell className="font-mono text-xs">{item.item_code}</TableCell>
                            <TableCell className="font-medium">{item.name}</TableCell>
                            <TableCell>{item.unit ?? "—"}</TableCell>
                            <TableCell className="tabular-nums">{formatInr(item.selling_price_paise)}</TableCell>
                            <TableCell className="tabular-nums">{item.quantity}</TableCell>
                            <TableCell className="whitespace-nowrap">
                              {item.expiry_date ? formatHospitalDate(item.expiry_date) : "—"}
                            </TableCell>
                            <TableCell><StatusBadge status={status} /></TableCell>
                            <TableCell className="text-right">
                              <InventoryItemDialog item={item} />
                            </TableCell>
                          </TableRow>
                        );
                      })
                    ) : (
                      <TableRow>
                        <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                          {q ? "No inventory item matches this search." : "No inventory items yet. Add gauze, sutures and dressing material here."}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            <TablePagination page={page} total={total} noun="items" params={{ q, tab }} size={PAGE_SIZE} />
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bill No</TableHead>
                    <TableHead>Date/Time</TableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead>Doctor</TableHead>
                    <TableHead>Procedure</TableHead>
                    <TableHead>Procedure Fee</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Settlement</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sales.length ? (
                    sales.map((sale) => (
                      <TableRow key={sale.id}>
                        <TableCell className="font-mono text-xs">
                          PR-{String(sale.sale_number).padStart(6, "0")}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{formatHospitalDate(sale.created_at, true)}</TableCell>
                        <TableCell>
                          <span className="font-medium">{sale.patient_name ?? "—"}</span>
                          <span className="block text-xs text-muted-foreground">{sale.patient_uhid ?? ""}</span>
                        </TableCell>
                        <TableCell>{sale.doctor_name ?? "—"}</TableCell>
                        <TableCell>{sale.procedure_name}</TableCell>
                        <TableCell className="tabular-nums">{formatInr(sale.procedure_fee_paise)}</TableCell>
                        <TableCell className="tabular-nums">{formatInr(sale.items_total_paise)}</TableCell>
                        <TableCell className="font-medium tabular-nums">{formatInr(sale.total_paise)}</TableCell>
                        <TableCell>
                          <span className="text-xs capitalize text-muted-foreground">
                            {sale.payment_mode?.replaceAll("_", " ") ?? "—"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            render={<Link href={`/print/procedure-bill/${sale.id}`} target="_blank" />}
                          >
                            <Printer /> View / Print
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={10} className="h-32 text-center text-muted-foreground">
                        No procedure bills yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <TablePagination page={page} total={total} noun="bills" params={{ q, tab }} size={PAGE_SIZE} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
