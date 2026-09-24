import Link from "next/link";
import { Printer } from "lucide-react";
import { requireRoute } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatHospitalDate } from "@/lib/domain/date";
import { formatInr } from "@/lib/domain/money";
import { formatPrescriptionNumber } from "@/lib/domain/prescription";
import { DispenseDialog } from "@/features/pharmacy/dispense-dialog";
import { ManualPrescriptionDialog } from "@/features/pharmacy/manual-prescription-dialog";
import { CollectPaymentDialog } from "@/features/visits/collect-payment-dialog";
import { DebouncedSearchInput } from "@/components/shared/debounced-search-input";
import { FilterTabs } from "@/components/shared/filter-tabs";
import { PAGE_SIZE, TablePagination, pageFromParam } from "@/components/shared/table-pagination";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
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

type Rx = {
  id: string;
  prescription_number: number;
  status: string;
  created_at: string;
  expires_at: string;
  visit_id: string | null;
  token_number: number | null;
  source: string;
  patient_name: string | null;
  patient_phone: string | null;
  doctor_name: string | null;
  consultation_fee_paise: number;
  consultation_balance_paise: number;
  latest_sale_id: string | null;
  items: Array<{
    id: string;
    medicine_id: string | null;
    medicine_name: string;
    dose: string | null;
    frequency: string | null;
    duration: string | null;
    route: string | null;
    dosage_form: string | null;
    strength: string | null;
    requested_quantity: number;
    dispensed_quantity: number;
  }>;
};
export default async function PharmacyPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  await requireRoute("/pharmacy");
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const selectedStatus =
    params.status === "completed" || params.status === "all" ? params.status : "pending";
  const page = pageFromParam(params.page);
  const supabase = await createSupabaseServerClient();
  // Expiry is not swept here: the Supabase pg_cron job
  // "expire-stale-hospital-prescriptions" runs every minute, so doing it per
  // request only added a round-trip and Vercel function time.
  // Read through an RPC: the pharmacy role has no SELECT on public.patients, so
  // an embedded join would silently return null patient names.
  const rxResult = await supabase.rpc("list_pending_prescriptions", {
    p_query: q || null,
    p_limit: PAGE_SIZE,
    p_status_filter: selectedStatus,
    p_offset: (page - 1) * PAGE_SIZE,
  });
  if (rxResult.error) {
    throw new Error("Pending prescriptions could not be loaded.");
  }
  const prescriptions = (rxResult.data ?? []) as unknown as Rx[];
  const total = Number((prescriptions[0] as unknown as { total_count?: number })?.total_count ?? 0);
  return (
    <div>
      <PageHeader
        title="Prescriptions"
        description="Full dispensing completes the prescription; partial quantities remain pending; unused prescriptions expire after 24 hours"
        actions={
          <>
            <FilterTabs
              ariaLabel="Filter prescriptions by status"
              active={selectedStatus}
              params={{ q }}
              tabs={[
                { label: "Pending", value: "pending" },
                { label: "Completed", value: "completed" },
                { label: "All", value: "all" },
              ]}
              className="mb-0"
            />
            <ManualPrescriptionDialog />
          </>
        }
      />
      <DebouncedSearchInput
        className="mb-4 max-w-md"
        initialValue={q}
        placeholder="Search token, patient name, phone or RX number"
        ariaLabel="Search prescriptions by token, patient or prescription number"
      />
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Token</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Prescription</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Doctor</TableHead>
                  <TableHead>Medicines</TableHead>
                  <TableHead>Pending Qty</TableHead>
                  <TableHead>Consultation Fee</TableHead>
                  <TableHead>Prescribed / Expires</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prescriptions.length ? (
                  prescriptions.map((rx) => {
                    const patient = rx.patient_name;
                    const source = rx.source.toLowerCase();
                    return (
                      <TableRow key={rx.id}>
                        <TableCell className="font-medium tabular-nums">
                          {rx.token_number ? `#${rx.token_number}` : "—"}
                        </TableCell>
                        <TableCell className="font-medium">
                          {patient ?? "—"}
                          {rx.patient_phone ? (
                            <span className="block text-xs font-normal text-muted-foreground">
                              {rx.patient_phone}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {formatPrescriptionNumber(rx.prescription_number)}
                        </TableCell>
                        <TableCell className="uppercase">{source}</TableCell>
                        <TableCell>{rx.doctor_name ?? "—"}</TableCell>
                        <TableCell>{rx.items.length}</TableCell>
                        <TableCell>
                          {rx.items.reduce(
                            (sum, item) =>
                              sum +
                              item.requested_quantity -
                              item.dispensed_quantity,
                            0,
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {rx.consultation_balance_paise > 0 ? (
                            <>
                              <span className="block font-medium">
                                {formatInr(rx.consultation_balance_paise)}
                              </span>
                              <span className="block text-xs text-muted-foreground">
                                to collect
                              </span>
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {rx.consultation_fee_paise > 0 ? "Paid" : "—"}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="block whitespace-nowrap">
                            {formatHospitalDate(rx.created_at, true)}
                          </span>
                          <span className="block whitespace-nowrap text-xs text-muted-foreground">
                            Expires {formatHospitalDate(rx.expires_at, true)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={rx.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                          {rx.status === "pending" || rx.status === "partially_dispensed" ? (
                            <DispenseDialog
                              key={`${rx.id}:${rx.status}:${rx.items.reduce((sum, item) => sum + item.dispensed_quantity, 0)}`}
                              prescriptionId={rx.id}
                              prescriptionNumber={formatPrescriptionNumber(
                                rx.prescription_number,
                              )}
                              patientName={patient ?? "Patient"}
                              source={source}
                              consultationBalancePaise={
                                rx.consultation_balance_paise
                              }
                              doctorName={rx.doctor_name}
                              items={rx.items.map((item) => ({
                                id: item.id,
                                medicineId: item.medicine_id,
                                name: item.medicine_name,
                                dose: item.dose,
                                frequency: item.frequency,
                                duration: item.duration,
                                route: item.route,
                                dosageForm: item.dosage_form,
                                strength: item.strength,
                                requested: item.requested_quantity,
                                dispensed: item.dispensed_quantity,
                              }))}
                            />
                          ) : (
                            <>
                              {/* A cancelled/no-medicine prescription never goes
                                  through DispenseDialog, so this is the only
                                  place left to settle a fee it left owing. */}
                              {rx.visit_id && rx.consultation_balance_paise > 0 ? (
                                <CollectPaymentDialog
                                  visitId={rx.visit_id}
                                  balancePaise={rx.consultation_balance_paise}
                                />
                              ) : null}
                              {rx.latest_sale_id ? (
                                <Button
                                  size="sm"
                                  render={<Link href={`/print/receipt/${rx.latest_sale_id}`} target="_blank" />}
                                >
                                  <Printer /> Receipt
                                </Button>
                              ) : null}
                            </>
                          )}
                          {/* Always available: preview/open the full
                              prescription -- what's on it, before or after
                              dispensing -- not only once it is closed out. */}
                          <Button
                            size="sm"
                            variant="outline"
                            render={<Link href={`/print/prescription/${rx.id}`} target="_blank" />}
                          >
                            <Printer /> Prescription
                          </Button>
                          {/* What the counter could not supply, as a
                              prescription the family can take to an outside
                              chemist. Only offered when something is actually
                              short. */}
                          {rx.items.some(
                            (item) =>
                              item.requested_quantity - item.dispensed_quantity > 0,
                          ) ? (
                            <Button
                              size="sm"
                              variant="outline"
                              render={<Link href={`/print/outside-purchase/${rx.id}`} target="_blank" />}
                            >
                              <Printer /> Outside Purchase
                            </Button>
                          ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={11}
                      className="h-32 text-center text-muted-foreground"
                    >
                      {q
                        ? "No prescription matches that search."
                        : selectedStatus === "completed"
                          ? "No dispensed prescriptions yet."
                          : selectedStatus === "all"
                            ? "No prescriptions yet."
                            : "No prescriptions waiting for dispensing."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <TablePagination
            page={page}
            total={total}
            noun="prescriptions"
            params={{ q, status: selectedStatus }}
            size={PAGE_SIZE}
          />
        </CardContent>
      </Card>
    </div>
  );
}
