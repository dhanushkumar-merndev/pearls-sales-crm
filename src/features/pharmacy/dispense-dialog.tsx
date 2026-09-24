"use client";
import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { CheckCircle2, LoaderCircle, PackageX, Pill, Printer, RefreshCw } from "lucide-react";
import { dispensePrescription, markPrescriptionUnavailable } from "./actions";
import { formatInr, packBreakdown } from "@/lib/domain/money";
import {
  allocateFefoStock,
  type FefoBatch,
  type FefoRequestLine,
} from "@/lib/domain/fefo-allocation";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const MODE_LABELS: Record<string, string> = { cash: "Cash", upi: "UPI", card: "Card", bank_transfer: "Bank Transfer", other: "Other" };

// The pharmacy counter is bounded by the stock in the batch, not by the
// prescribed quantity: it may hand over more when the stock is there.
const ALLOW_EXCESS = { allowExceedingRequest: true } as const;

type Item = {
  id: string;
  medicineId: string | null;
  name: string;
  dose?: string | null;
  frequency?: string | null;
  duration?: string | null;
  route?: string | null;
  dosageForm?: string | null;
  strength?: string | null;
  requested: number;
  dispensed: number;
};
type DispenseLine = {
  itemId: string;
  preferredBatchId: string | null;
  quantity: number;
};
export function DispenseDialog({
  prescriptionId,
  prescriptionNumber,
  patientName,
  source,
  items,
  consultationBalancePaise,
  doctorName,
}: {
  prescriptionId: string;
  prescriptionNumber: string;
  patientName: string;
  source: string;
  items: Item[];
  /** Outstanding consultation fee the doctor set, collected at this counter. */
  consultationBalancePaise?: number;
  doctorName?: string | null;
}) {
  const [state, action, pending] = useActionState(dispensePrescription, {
    ok: false,
  });
  const [unavailableState, unavailableAction, markingUnavailable] = useActionState(
    markPrescriptionUnavailable,
    { ok: false },
  );
  const [mode, setMode] = useState("cash");
  const [open, setOpen] = useState(false);
  const [batches, setBatches] = useState<FefoBatch[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);
  const [key] = useState(() => crypto.randomUUID());
  const [unavailableKey] = useState(() => crypto.randomUUID());
  const outstanding = consultationBalancePaise ?? 0;
  const feeCollected = outstanding > 0 ? (outstanding / 100).toFixed(2) : "";
  // The consultant's prescription sets what is still pending. The counter may
  // supply less (a shortage stays pending) or more than that, bounded by the
  // stock actually in the selected batch; supplying more raises the recorded
  // prescribed quantity on the server and is written to the audit trail.
  const pendingFor = (item: Item) => item.requested - item.dispensed;
  const requestLines = (candidate: DispenseLine[]): FefoRequestLine[] =>
    candidate.map((line) => {
      const item = items.find((candidateItem) => candidateItem.id === line.itemId);
      return {
        itemId: line.itemId,
        medicineId: item?.medicineId ?? null,
        requestedQuantity: item ? pendingFor(item) : 0,
        selectedQuantity: line.quantity,
        preferredBatchId: line.preferredBatchId,
      };
    });
  const reconcileLines = (candidate: DispenseLine[], stock = batches) => {
    const allocations = allocateFefoStock(requestLines(candidate), stock, ALLOW_EXCESS);
    return candidate.map((line, index) => ({
      ...line,
      quantity: allocations[index].selectedQuantity,
    }));
  };
  const [lines, setLines] = useState<DispenseLine[]>(() =>
    items.map((item) => ({
      itemId: item.id,
      preferredBatchId: null,
      quantity: 0,
    })),
  );
  const allocations = useMemo(
    () => allocateFefoStock(requestLines(lines), batches, ALLOW_EXCESS),
    // requestLines is deliberately derived from these current props/states.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [batches, items, lines],
  );
  const payload = useMemo(
    () =>
      allocations.flatMap((allocation, index) =>
        allocation.batches.map((batch) => ({
          prescription_item_id: lines[index].itemId,
          batch_id: batch.batchId,
          quantity: batch.quantity,
        })),
      ),
    [allocations, lines],
  );
  // Mirrors the server's rounding (round(qty * pack price / units per pack))
  // so what the pharmacist sees before confirming matches the receipt after.
  const batchAmountPaise = (batchId: string, quantity: number) => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch || quantity <= 0) return 0;
    return Math.round((quantity * batch.pricePaise) / Math.max(batch.unitsPerPack, 1));
  };
  const medicinesTotalPaise = useMemo(
    () =>
      allocations.reduce(
        (total, allocation) =>
          total +
          allocation.batches.reduce(
            (lineTotal, batch) =>
              lineTotal + batchAmountPaise(batch.batchId, batch.quantity),
            0,
          ),
        0,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allocations, batches],
  );
  // The pharmacy counter cannot close an OP prescription while the doctor's
  // consultation fee is still outstanding.
  const feeEntered = Number(feeCollected);
  const feeUnpaid =
    source === "op" &&
    outstanding > 0 &&
    (!feeCollected.trim() || Number.isNaN(feeEntered) || feeEntered <= 0);
  // The consultation fee the doctor set can be collected at the same counter.
  const feeCollectedPaise =
    source === "op" && feeCollected.trim() && !Number.isNaN(feeEntered) && feeEntered > 0
      ? Math.round(feeEntered * 100)
      : 0;
  const totalToCollectPaise = medicinesTotalPaise + feeCollectedPaise;
  const totalPending = items.reduce(
    (sum, item) => sum + item.requested - item.dispensed,
    0,
  );
  const remainingItems = items
    .map((item) => ({ item, quantity: pendingFor(item) }))
    .filter(({ quantity }) => quantity > 0);
  const totalSelected = payload.reduce((sum, line) => sum + line.quantity, 0);
  const totalExcess = allocations.reduce(
    (sum, allocation) => sum + allocation.excessQuantity,
    0,
  );
  const dispenseLabel =
    totalExcess > 0
      ? "Confirm Dispense With Extra"
      : totalSelected === totalPending
        ? "Confirm Full Dispense"
        : "Dispense Available Quantity";
  const refreshStock = async () => {
    const medicineIds = [
      ...new Set(items.map((item) => item.medicineId).filter((id): id is string => Boolean(id))),
    ];
    setStockLoading(true);
    setStockError(null);
    try {
      if (medicineIds.length === 0) {
        setBatches([]);
        setLines((rows) => rows.map((line) => ({ ...line, quantity: 0 })));
        return;
      }
      const response = await fetch(
        `/api/pharmacy/dispense-batches?medicineIds=${encodeURIComponent(medicineIds.join(","))}`,
        { cache: "no-store" },
      );
      const body = (await response.json()) as {
        batches?: FefoBatch[];
        error?: string;
      };
      if (!response.ok || !Array.isArray(body.batches)) {
        throw new Error(body.error ?? "Live stock unavailable");
      }
      const fresh = body.batches;
      setBatches(fresh);
      setLines((current) =>
        reconcileLines(
          items.map((item) => ({
            itemId: item.id,
            preferredBatchId:
              current.find((line) => line.itemId === item.id)?.preferredBatchId ?? null,
            quantity: pendingFor(item),
          })),
          fresh,
        ),
      );
    } catch {
      setBatches([]);
      setLines((rows) => rows.map((line) => ({ ...line, quantity: 0 })));
      setStockError("Live stock could not be refreshed. Nothing can be dispensed until it loads.");
    } finally {
      setStockLoading(false);
    }
  };
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) void refreshStock();
  };
  if (unavailableState.ok) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-3">
        <p className="text-sm text-muted-foreground">
          Remaining medicines were not supplied. No sale, payment, or stock
          movement was created.
        </p>
        <Button size="sm" variant="outline" disabled>
          <CheckCircle2 /> Unavailable recorded
        </Button>
        <Button
          size="sm"
          render={<Link href={`/print/outside-purchase/${prescriptionId}`} target="_blank" />}
        >
          <Printer /> Outside Purchase
        </Button>
      </div>
    );
  }
  if (state.ok) {
    const completed = state.data?.prescriptionStatus === "dispensed";
    const medicinesPaise = Number(state.data?.medicinesPaise ?? 0);
    const consultationPaise = Number(state.data?.consultationPaise ?? 0);
    // The receipt is the point of the counter transaction: it covers the
    // medicines and, when it was taken here, the consultation fee.
    return (
      <div className="flex flex-wrap items-center justify-end gap-3">
        <p className="text-sm text-muted-foreground">
          Medicines {formatInr(medicinesPaise)}
          {consultationPaise > 0
            ? ` + Doctor fee ${formatInr(consultationPaise)} = `
            : " = "}
          <span className="font-semibold text-foreground">
            Total {formatInr(medicinesPaise + consultationPaise)} collected
          </span>
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled>
            <CheckCircle2 />
            {completed ? "Completed" : "Partially Dispensed"}
          </Button>
          <Button
            size="sm"
            render={<Link href={`/print/receipt/${state.data?.saleId}`} target="_blank" />}
          >
            <Printer /> Payment Receipt
          </Button>
          <Button
            size="sm"
            variant="outline"
            render={<Link href={`/print/prescription/${prescriptionId}`} target="_blank" />}
          >
            <Printer /> Prescription
          </Button>
          {/* Partially dispensed means something is still owed to the
              patient: hand them the slip for it at the same counter. */}
          {completed ? null : (
            <Button
              size="sm"
              variant="outline"
              render={<Link href={`/print/outside-purchase/${prescriptionId}`} target="_blank" />}
            >
              <Printer /> Outside Purchase
            </Button>
          )}
        </div>
      </div>
    );
  }
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" />}>
        <Pill /> Dispense
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-5xl">
        <form action={action} className="contents">
          <DialogHeader>
            <DialogTitle>Dispense {prescriptionNumber}</DialogTitle>
            <DialogDescription>
              {patientName} · {source.toUpperCase()} · Combined live stock is
              split across batches in FEFO order. Stock is neither reserved nor
              reduced until you confirm the actual quantity.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {stockLoading
                ? "Loading current batch quantities…"
                : `${batches.length} active, unexpired batch${batches.length === 1 ? "" : "es"} loaded`}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={stockLoading || pending}
              onClick={() => void refreshStock()}
            >
              {stockLoading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
              Refresh live stock
            </Button>
          </div>
          <input type="hidden" name="prescriptionId" value={prescriptionId} />
          <input type="hidden" name="idempotencyKey" value={key} />
          <input
            type="hidden"
            name="unavailableIdempotencyKey"
            value={unavailableKey}
          />
          <input type="hidden" name="lines" value={JSON.stringify(payload)} />
          <input type="hidden" name="paymentMode" value={mode} />
          {stockError || state.message || unavailableState.message ? (
            <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {stockError || state.message || unavailableState.message}
            </p>
          ) : null}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>S.No</TableHead>
                  <TableHead className="min-w-40">Medicine &amp; Form</TableHead>
                  <TableHead>Strength</TableHead>
                  <TableHead>Dose &amp; Frequency</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Supplied</TableHead>
                  <TableHead>Available now</TableHead>
                  <TableHead className="min-w-64">
                    Batch allocation (FEFO)
                  </TableHead>
                  <TableHead>Dispense now</TableHead>
                  <TableHead>Not supplied now</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, index) => {
                  const options = batches.filter(
                    (batch) =>
                      batch.medicineId === item.medicineId &&
                      batch.quantity > 0,
                  );
                  const pending = pendingFor(item);
                  const line = lines[index];
                  const allocation = allocations[index];
                  const availableNow = allocation?.availableNow ?? 0;
                  const maximumDispense = availableNow;
                  const notSupplied = allocation?.notSuppliedQuantity ?? pending;
                  const excess = allocation?.excessQuantity ?? 0;
                  const allocatedBatches = (allocation?.batches ?? []).map((entry) => ({
                    ...entry,
                    batch: options.find((batch) => batch.id === entry.batchId),
                  }));
                  const lineAmount = allocatedBatches.reduce(
                    (sum, entry) =>
                      sum + batchAmountPaise(entry.batchId, entry.quantity),
                    0,
                  );
                  const commonPack =
                    options.length > 0 &&
                    options.every((batch) => batch.unitsPerPack === options[0].unitsPerPack)
                      ? options[0].unitsPerPack
                      : 1;
                  const resultLabel =
                    excess > 0
                      ? `Extra · ${excess} over prescription`
                      : notSupplied === 0
                        ? "Full dispense"
                        : (line?.quantity ?? 0) === 0
                          ? "Still pending"
                          : `Partial · ${notSupplied} still pending`;
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                      <TableCell className="font-medium">
                        {item.name}
                        {item.dosageForm ? (
                          <span className="block text-xs font-normal text-muted-foreground">
                            {item.dosageForm}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {item.strength ?? "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {[item.dose, item.frequency].filter(Boolean).join(" · ") || "—"}
                        {item.duration ? (
                          <span className="block text-xs text-muted-foreground">
                            {item.duration}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <span className="tabular-nums">{item.requested}</span>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          As prescribed
                        </p>
                      </TableCell>
                      <TableCell>
                        <span className="tabular-nums">{item.dispensed}</span>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Already supplied
                        </p>
                      </TableCell>
                      <TableCell>
                        <span className="tabular-nums">{availableNow}</span>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Across {options.length} batch{options.length === 1 ? "" : "es"}
                        </p>
                      </TableCell>
                      <TableCell className="space-y-2">
                        <Select
                          value={line?.preferredBatchId ?? "fefo"}
                          onValueChange={(value) => {
                            setLines((rows) =>
                              reconcileLines(rows.map((row, i) =>
                                i === index
                                  ? {
                                      ...row,
                                      preferredBatchId:
                                        String(value) === "fefo" ? null : String(value),
                                    }
                                  : row,
                              )),
                            );
                          }}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue>
                              {() =>
                                line?.preferredBatchId
                                  ? `Start with ${options.find((batch) => batch.id === line.preferredBatchId)?.batchNumber ?? "selected batch"}`
                                  : "Automatic FEFO"}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="fefo">Automatic FEFO</SelectItem>
                            {options.map((batch) => (
                              <SelectItem key={batch.id} value={batch.id} label={`${batch.batchNumber} · ${batch.expiry} · ${batch.quantity}`}>
                                {batch.batchNumber} · {batch.expiry} ·{" "}
                                {batch.quantity}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {allocatedBatches.length ? (
                          <ul className="space-y-1 text-xs" aria-label={`Batch allocation for ${item.name}`}>
                            {allocatedBatches.map((entry) => (
                              <li key={entry.batchId} className="flex justify-between gap-3">
                                <span>
                                  {entry.batch?.batchNumber ?? "Batch"} · {entry.batch?.expiry ?? "—"}
                                </span>
                                <span className="font-medium tabular-nums">{entry.quantity}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-xs text-destructive">
                            {stockLoading ? "Checking stock…" : "No active unexpired stock"}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Input
                          className="w-24"
                          aria-label={`Dispense now for ${item.name}`}
                          type="number"
                          min={0}
                          max={maximumDispense}
                          value={line?.quantity ?? 0}
                          onChange={(event) =>
                            setLines((rows) =>
                              reconcileLines(rows.map((row, i) =>
                                i === index
                                  ? {
                                      ...row,
                                      quantity: Number(event.target.value),
                                    }
                                  : row,
                              )),
                            )
                          }
                          disabled={stockLoading || maximumDispense === 0}
                        />
                        {/* Whole-strip entry remains available when every batch
                            uses the same pack size; mixed pack sizes are priced
                            and shown separately in the FEFO breakdown. */}
                        {(() => {
                          const pack = commonPack;
                          if (pack <= 1) return null;
                          const pieces = line?.quantity ?? 0;
                          return (
                            <div className="mt-1 space-y-0.5">
                              <p className="text-[11px] text-muted-foreground">
                                {packBreakdown(pieces, pack)?.label ?? `${pieces}`}
                              </p>
                              <Button
                                type="button"
                                size="xs"
                                variant="link"
                                className="h-auto px-0 text-[11px]"
                                onClick={() =>
                                  setLines((rows) =>
                                    reconcileLines(rows.map((row, i) => {
                                      if (i !== index) return row;
                                      // Round down what is already typed; never
                                      // increase the total merely by clicking.
                                      const target =
                                        pieces > 0
                                          ? pieces
                                          : Math.min(pending, maximumDispense);
                                      return {
                                        ...row,
                                        quantity: Math.min(
                                          Math.floor(target / pack) * pack,
                                          maximumDispense,
                                        ),
                                      };
                                    })),
                                  )
                                }
                              >
                                Whole strips only
                              </Button>
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <span className="tabular-nums">{notSupplied}</span>
                        <p
                          className={
                            "mt-1 text-[11px] " +
                            (excess > 0
                              ? "text-amber-600 dark:text-amber-500"
                              : notSupplied === 0
                                ? "text-muted-foreground"
                                : "text-destructive")
                          }
                        >
                          {resultLabel}
                        </p>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatInr(lineAmount)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Stock rule:</span>{" "}
            “Available now” adds every active, unexpired batch. The entered total
            is split by earliest expiry first; choosing another priority batch
            uses it first and then resumes FEFO. Confirm Dispense changes each
            exact batch only by the quantities shown above.
            “Not supplied now” stays pending until it is supplied or you close
            the remaining prescription as unavailable. Supplying more than was
            prescribed raises the recorded prescribed quantity and is written to
            the audit trail.
          </p>
          {source === "op" ? (
            <div className="flex flex-wrap gap-4">
              <div className="space-y-2">
                <Label>Payment mode</Label>
                <Select
                  value={mode}
                  onValueChange={(value) => setMode(value as string)}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue>{() => MODE_LABELS[mode] ?? mode}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="upi">UPI</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {outstanding > 0 ? (
                <div className="space-y-2">
                  <Label htmlFor={`fee-${prescriptionId}`}>
                    Consultation fee collected (₹){" "}
                    <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id={`fee-${prescriptionId}`}
                    name="consultationCollected"
                    inputMode="decimal"
                    className="w-48"
                    value={feeCollected}
                    readOnly
                  />
                  <p className="text-xs text-muted-foreground">
                    Set by {doctorName ?? "the consulting doctor"} · outstanding{" "}
                    {formatInr(outstanding)}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
          {/* What the pharmacist should actually collect at the counter,
              known before confirming rather than only after on the receipt. */}
          <div className="flex justify-end border-t pt-3 text-sm">
            <dl className="space-y-1 text-right">
              <div className="flex justify-between gap-6">
                <dt className="text-muted-foreground">Medicines</dt>
                <dd className="tabular-nums">{formatInr(medicinesTotalPaise)}</dd>
              </div>
              {feeCollectedPaise > 0 ? (
                <div className="flex justify-between gap-6">
                  <dt className="text-muted-foreground">Doctor fee</dt>
                  <dd className="tabular-nums">{formatInr(feeCollectedPaise)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-6 font-semibold">
                <dt>Total to collect</dt>
                <dd className="tabular-nums">{formatInr(totalToCollectPaise)}</dd>
              </div>
            </dl>
          </div>
          <DialogFooter showCloseButton>
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending || markingUnavailable || remainingItems.length === 0}
                  />
                }
              >
                <PackageX /> Close remaining as unavailable
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Mark remaining medicines unavailable?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This records that these quantities were not supplied. It does not
                    change stock or collect payment, and it cannot be reopened.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <ul className="space-y-1 text-sm">
                  {remainingItems.map(({ item, quantity }) => (
                    <li key={item.id} className="flex justify-between gap-4">
                      <span>{item.name}</span>
                      <span className="font-medium tabular-nums">{quantity}</span>
                    </li>
                  ))}
                </ul>
                {totalSelected > 0 ? (
                  <p className="text-sm text-destructive">
                    This also discards the {totalSelected} unit{totalSelected === 1 ? "" : "s"} currently selected above; no sale or stock movement will be made.
                  </p>
                ) : null}
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={markingUnavailable}>Cancel</AlertDialogCancel>
                  <form action={unavailableAction}>
                    <input type="hidden" name="prescriptionId" value={prescriptionId} />
                    <input
                      type="hidden"
                      name="unavailableIdempotencyKey"
                      value={unavailableKey}
                    />
                    <AlertDialogAction
                      type="submit"
                      variant="destructive"
                      disabled={markingUnavailable}
                    >
                      {markingUnavailable ? <LoaderCircle className="animate-spin" /> : <PackageX />}
                      Confirm unavailable
                    </AlertDialogAction>
                  </form>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button
              disabled={
                pending ||
                markingUnavailable ||
                stockLoading ||
                Boolean(stockError) ||
                payload.length === 0 ||
                feeUnpaid
              }
              type="submit"
            >
              {pending ? <LoaderCircle className="animate-spin" /> : <Pill />}{" "}
              {feeUnpaid ? "Consultation fee pending" : dispenseLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
