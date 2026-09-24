import Link from "next/link";
import { Archive, Undo2 } from "lucide-react";
import { requireRoute } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MedicineDialog } from "@/features/pharmacy/medicine-dialogs";
import { RestoreMedicineButton } from "@/features/pharmacy/medicine-removal-buttons";
import { groupFieldOptions } from "@/features/pharmacy/medicine-field-options";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { DebouncedSearchInput } from "@/components/shared/debounced-search-input";
import { PAGE_SIZE, TablePagination, pageFromParam } from "@/components/shared/table-pagination";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  manufacturer: string | null;
  active: boolean;
  archived_at: string | null;
  total_count: number;
};

export default async function MedicinesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; view?: string }>;
}) {
  const profile = await requireRoute("/pharmacy/medicines");
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const page = pageFromParam(params.page);
  const size = PAGE_SIZE;
  // Removed medicines are a separate view, not a filter mixed into the
  // library: nothing that reads the directory should ever have to remember to
  // exclude them. Only an admin can remove or restore one, so only an admin
  // is offered the view.
  const canRemove = profile.role === "admin";
  const removedView = canRemove && params.view === "removed";
  const supabase = await createSupabaseServerClient();
  // The learned dropdown values come from their own small table, so this is a
  // few hundred rows regardless of how large the directory itself grows.
  const [{ data }, { data: optionRows }] = await Promise.all([
    supabase.rpc("list_medicine_directory", {
      p_query: q,
      p_limit: size,
      p_offset: (page - 1) * size,
      p_include_archived: removedView,
    }),
    supabase.rpc("get_medicine_field_options", { p_limit: 200 }),
  ]);
  const fieldOptions = groupFieldOptions(
    optionRows as Array<{ field: string; value: string }> | null,
  );
  const rows = (data ?? []) as unknown as Medicine[];
  const count = Number(rows[0]?.total_count ?? 0);
  const href = (next: { page?: number; view?: string | null }) => {
    const search = new URLSearchParams();
    if (q) search.set("q", q);
    const view = next.view === undefined ? (removedView ? "removed" : null) : next.view;
    if (view) search.set("view", view);
    if (next.page && next.page > 1) search.set("page", String(next.page));
    const query = search.toString();
    return query ? `?${query}` : "?";
  };
  return (
    <div>
      <PageHeader
        title={removedView ? "Removed Medicines" : "Medicine Master"}
        description={
          removedView
            ? `${count} medicine definitions taken out of the library · every past prescription, bill and stock record is unchanged`
            : `${count} medicine definitions · quantities and batches are managed under Stock & Batches`
        }
        actions={
          <>
            {canRemove ? (
              <Button
                size="sm"
                variant="outline"
                render={<Link href={href({ page: 1, view: removedView ? null : "removed" })} />}
              >
                {removedView ? <Undo2 /> : <Archive />}
                {removedView ? "Back to library" : "Removed"}
              </Button>
            ) : null}
            {removedView ? null : (
              <MedicineDialog
                canDelete={canRemove}
                fieldOptions={fieldOptions}
              />
            )}
          </>
        }
      />
      <DebouncedSearchInput
        className="mb-4 max-w-md"
        initialValue={q}
        placeholder="Search medicine, generic, strength"
        ariaLabel={removedView ? "Search removed medicines" : "Search medicine master"}
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
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length ? (
                  rows.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        {item.brand_name}
                      </TableCell>
                      <TableCell>{item.generic_name ?? "—"}</TableCell>
                      <TableCell>{item.strength ?? "—"}</TableCell>
                      <TableCell>{item.dosage_form}</TableCell>
                      <TableCell>
                        {item.archived_at ? (
                          <Badge variant="secondary" className="whitespace-nowrap">
                            Removed
                          </Badge>
                        ) : (
                          <StatusBadge
                            status={item.active ? "active" : "inactive"}
                          />
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.archived_at ? (
                          <RestoreMedicineButton
                            id={item.id}
                            label={item.brand_name}
                          />
                        ) : (
                          <MedicineDialog
                            canDelete={canRemove}
                            fieldOptions={fieldOptions}
                            item={{
                              id: item.id,
                              brandName: item.brand_name,
                              genericName: item.generic_name,
                              strength: item.strength,
                              dosageForm: item.dosage_form,
                              manufacturer: item.manufacturer,
                              active: item.active,
                            }}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="h-32 text-center text-muted-foreground"
                    >
                      {removedView
                        ? "No medicine has been removed from the library."
                        : "No medicines found."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <TablePagination
            page={page}
            total={count}
            noun={removedView ? "removed medicines" : "medicines"}
            params={{ q, view: removedView ? "removed" : undefined }}
            size={size}
          />
        </CardContent>
      </Card>
    </div>
  );
}
