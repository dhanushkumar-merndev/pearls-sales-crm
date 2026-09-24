import Link from "next/link";
import { Printer } from "lucide-react";
import { requireRoute } from "@/lib/auth/dal";
import { Button } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatHospitalDate } from "@/lib/domain/date";
import { formatInr } from "@/lib/domain/money";
import { PageHeader } from "@/components/shared/page-header";
import { DebouncedSearchInput } from "@/components/shared/debounced-search-input";
import { TablePager } from "@/components/shared/table-pager";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Read through list_pharmacy_sales: the pharmacy role has no SELECT on
// public.patients, so an embedded patients(...) join left the patient column
// blank for exactly the staff who work this screen.
type Sale = { id: string; created_at: string; source: string; total_paise: number; patient_name: string | null; patient_phone: string | null; dispensed_by: string | null; item_count: number; total_count: number };
export default async function SalesPage({ searchParams }: { searchParams: Promise<{ page?: string; q?: string }> }) {
  await requireRoute("/pharmacy/sales");
  const params = await searchParams; const page = Math.max(1, Number(params.page) || 1); const size = 50; const q = params.q?.trim() ?? "";
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("list_pharmacy_sales", { p_query: q || null, p_limit: size, p_offset: (page - 1) * size });
  const rows = (data ?? []) as unknown as Sale[];
  const count = rows[0]?.total_count ?? 0;
  return <div><PageHeader title="Pharmacy Sales" description="Prescription sales dispensed and collected at the pharmacy counter." /><DebouncedSearchInput className="mb-4 max-w-md" initialValue={q} placeholder="Search patient name or phone" ariaLabel="Search pharmacy sales" /><Card><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Date/Time</TableHead><TableHead>Patient</TableHead><TableHead>Source</TableHead><TableHead>Items</TableHead><TableHead>Total</TableHead><TableHead>Dispensed By</TableHead><TableHead className="text-right">Record</TableHead></TableRow></TableHeader><TableBody>{rows.length ? rows.map((sale) => {
    return <TableRow key={`${sale.source}-${sale.id}`}><TableCell>{formatHospitalDate(sale.created_at, true)}</TableCell><TableCell><span className="font-medium">{sale.patient_name ?? "—"}</span><span className="block text-xs text-muted-foreground">{sale.patient_phone ?? ""}</span></TableCell><TableCell><span className="uppercase">{sale.source}</span></TableCell><TableCell>{sale.item_count}</TableCell><TableCell>{formatInr(sale.total_paise)}</TableCell><TableCell>{sale.dispensed_by ?? "—"}</TableCell><TableCell className="text-right"><Button size="sm" variant="outline" render={<Link href={`/print/receipt/${sale.id}`} target="_blank" />}><Printer /> Receipt</Button></TableCell></TableRow>;
  }) : <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground">{q ? "No pharmacy dispensing records match this search." : "No pharmacy dispensing records."}</TableCell></TableRow>}</TableBody></Table></div><TablePager page={page} pages={Math.max(1, Math.ceil(Number(count) / size))} total={Number(count)} params={{ q }} /></CardContent></Card></div>;
}
