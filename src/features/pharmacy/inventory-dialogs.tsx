"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { CheckCircle2, LoaderCircle, Pencil, Plus, Printer, Receipt } from "lucide-react";
import { createProcedureSale, saveInventoryItem } from "./inventory-actions";
import type { ActionState } from "@/types/hospital";
import { formatInr } from "@/lib/domain/money";
import { PatientCombobox, type PatientOption } from "@/components/shared/patient-combobox";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";

const initial: ActionState = { ok: false };
const MODE_LABELS: Record<string, string> = { cash: "Cash", upi: "UPI", card: "Card", bank_transfer: "Bank Transfer", other: "Other" };

export type InventoryItem = {
  id: string;
  item_code: number;
  name: string;
  unit: string | null;
  selling_price_paise: number;
  quantity: number;
  low_stock_threshold: number;
  expiry_date: string | null;
  active: boolean;
};

export function InventoryItemDialog({ item }: { item?: InventoryItem }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(saveInventoryItem, initial);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) setIdempotencyKey(crypto.randomUUID());
      }}
    >
      <DialogTrigger render={<Button size={item ? "sm" : "default"} variant={item ? "outline" : "default"} />}>
        {item ? <Pencil /> : <Plus />} {item ? "Edit" : "Add Item"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form action={action} className="contents">
          <DialogHeader>
            <DialogTitle>{item ? "Edit inventory item" : "Add inventory item"}</DialogTitle>
            <DialogDescription>
              Consumables such as gauze, sutures and dressing material. Medicines
              are managed separately under Medicine Master. Every stock change is
              recorded as a traceable plus or minus entry.
            </DialogDescription>
          </DialogHeader>
          {item ? <input type="hidden" name="id" value={item.id} /> : null}
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          {state.message && !state.ok ? (
            <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{state.message}</p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="inv-name">Item name *</Label>
              <Input id="inv-name" name="name" defaultValue={item?.name} required autoFocus />
              {state.fieldErrors?.name?.map((e) => <p key={e} className="text-xs text-destructive">{e}</p>)}
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-unit">Unit</Label>
              <Input id="inv-unit" name="unit" defaultValue={item?.unit ?? ""} placeholder="piece / roll / packet" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-price">Price (₹) *</Label>
              <Input id="inv-price" name="price" inputMode="decimal" defaultValue={item ? (item.selling_price_paise / 100).toFixed(2) : ""} required />
              {state.fieldErrors?.price?.map((e) => <p key={e} className="text-xs text-destructive">{e}</p>)}
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-qty">{item ? "Counted quantity" : "Opening quantity"} *</Label>
              <Input id="inv-qty" name="quantity" type="number" min={0} defaultValue={item?.quantity ?? 0} required />
              <p className="text-xs text-muted-foreground">
                {item
                  ? `Current system stock: ${item.quantity}. Saving records the difference as a plus or minus adjustment.`
                  : "The opening quantity is recorded as a stock-in entry."}
              </p>
              {state.fieldErrors?.quantity?.map((e) => <p key={e} className="text-xs text-destructive">{e}</p>)}
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="inv-reason">{item ? "Reason for adjustment" : "Reason for opening stock"} *</Label>
              <Input
                id="inv-reason"
                name="reason"
                defaultValue={item ? "Physical count adjustment" : "Opening stock"}
                maxLength={200}
                required
              />
              {state.fieldErrors?.reason?.map((e) => <p key={e} className="text-xs text-destructive">{e}</p>)}
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-low">Low stock alert at</Label>
              <Input id="inv-low" name="lowStockThreshold" type="number" min={0} defaultValue={item?.low_stock_threshold ?? 20} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="inv-expiry">Expiry date</Label>
              <Input id="inv-expiry" name="expiryDate" type="date" defaultValue={item?.expiry_date ?? ""} />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="active" defaultChecked={item?.active ?? true} className="size-4" />
              Active
            </label>
          </div>
          <DialogFooter showCloseButton>
            <Button disabled={pending} type="submit">
              {pending ? <LoaderCircle className="animate-spin" /> : <Plus />} Save Item
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Procedure billing. A patient can walk in for a dressing or an aesthetic
 * procedure with no OP visit at all, so only the patient and procedure name
 * are required; the amount is collected here.
 */
export function ProcedureBillDialog({
  items,
  doctors,
}: {
  items: InventoryItem[];
  doctors: Array<{ id: string; label: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createProcedureSale, initial);
  const [patient, setPatient] = useState<PatientOption | null>(null);
  const [doctorId, setDoctorId] = useState("");
  const [mode, setMode] = useState("cash");
  const [fee, setFee] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const [lines, setLines] = useState<Array<{ key: string; itemId: string; quantity: number }>>([]);

  const payload = useMemo(
    () => lines.filter((l) => l.itemId && l.quantity > 0).map((l) => ({ inventory_item_id: l.itemId, quantity: l.quantity })),
    [lines],
  );
  const itemsTotal = useMemo(
    () => payload.reduce((sum, l) => sum + (items.find((i) => i.id === l.inventory_item_id)?.selling_price_paise ?? 0) * l.quantity, 0),
    [payload, items],
  );
  const feePaise = Math.round((Number(fee) || 0) * 100);
  const total = itemsTotal + feePaise;

  if (state.ok && state.data?.saleId) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button />}>
          <Receipt /> New Procedure Bill
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="text-primary" /> Bill created
            </DialogTitle>
            <DialogDescription>
              {formatInr(total)} billed for {patient?.label ?? "the patient"}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button
              variant="outline"
              render={<Link href={`/print/procedure-bill/${state.data.saleId}`} target="_blank" />}
            >
              <Printer /> Print Bill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Receipt /> New Procedure Bill
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-3xl">
        <form action={action} className="contents">
          <DialogHeader>
            <DialogTitle>Procedure bill</DialogTitle>
            <DialogDescription>
              For dressings and procedures, with or without an OP consultation.
              Stock is reduced only when this bill is created.
            </DialogDescription>
          </DialogHeader>
          <input type="hidden" name="patientId" value={patient?.id ?? ""} />
          <input type="hidden" name="doctorId" value={doctorId} />
          <input type="hidden" name="paymentMode" value={mode} />
          <input type="hidden" name="idempotencyKey" value={key} />
          <input type="hidden" name="lines" value={JSON.stringify(payload)} />
          {state.message ? (
            <p className={`rounded-md p-3 text-sm ${state.ok ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>
              {state.message}
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Patient *</Label>
              <PatientCombobox value={patient} onChange={setPatient} />
            </div>
            <div className="space-y-2">
              <Label>Consultant doctor</Label>
              <Select value={doctorId} onValueChange={(v) => setDoctorId(String(v))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Not applicable">
                    {() => doctors.find((d) => d.id === doctorId)?.label ?? "Not applicable"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {doctors.map((d) => (
                    <SelectItem key={d.id} value={d.id} label={d.label}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="proc-name">Procedure name *</Label>
              <Input id="proc-name" name="procedureName" placeholder="Dressing / Suturing / Nebulisation" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="proc-fee">Procedure fee (₹)</Label>
              <Input id="proc-fee" name="procedureFee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-2">
              <Label>Payment mode</Label>
              <Select value={mode} onValueChange={(v) => setMode(String(v))}>
                <SelectTrigger className="w-full"><SelectValue>{() => MODE_LABELS[mode] ?? mode}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Inventory items used</Label>
              <Button type="button" size="sm" variant="outline"
                onClick={() => setLines((r) => [...r, { key: crypto.randomUUID(), itemId: "", quantity: 1 }])}>
                <Plus /> Add Item
              </Button>
            </div>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Available</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.length ? lines.map((line, index) => {
                    const selected = items.find((i) => i.id === line.itemId);
                    return (
                      <TableRow key={line.key}>
                        <TableCell className="min-w-56">
                          <Select value={line.itemId} onValueChange={(v) => setLines((r) => r.map((l, i) => i === index ? { ...l, itemId: String(v) } : l))}>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select item">{() => selected?.name ?? "Select item"}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {items.filter((i) => i.active && i.quantity > 0).map((i) => (
                                <SelectItem key={i.id} value={i.id} label={i.name}>
                                  {i.name} · {formatInr(i.selling_price_paise)} · {i.quantity} left
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="tabular-nums">{selected?.quantity ?? "—"}</TableCell>
                        <TableCell>
                          <Input className="w-20" type="number" min={1} max={selected?.quantity ?? 999}
                            value={line.quantity}
                            onChange={(e) => setLines((r) => r.map((l, i) => i === index ? { ...l, quantity: Math.max(1, Number(e.target.value)) } : l))} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatInr((selected?.selling_price_paise ?? 0) * line.quantity)}
                        </TableCell>
                        <TableCell>
                          <Button type="button" size="sm" variant="ghost"
                            onClick={() => setLines((r) => r.filter((_, i) => i !== index))}>Remove</Button>
                        </TableCell>
                      </TableRow>
                    );
                  }) : (
                    <TableRow>
                      <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                        No items added. A procedure fee alone can still be billed.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="proc-notes">Notes</Label>
            <Textarea id="proc-notes" name="notes" rows={2} />
          </div>

          <div className="rounded-md border p-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Procedure fee</span><span className="tabular-nums">{formatInr(feePaise)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Inventory items</span><span className="tabular-nums">{formatInr(itemsTotal)}</span></div>
            <div className="mt-1 flex justify-between border-t pt-1 font-medium"><span>Total</span><span className="tabular-nums">{formatInr(total)}</span></div>
          </div>

          <DialogFooter showCloseButton>
            <Button disabled={pending || !patient || total <= 0} type="submit">
              {pending ? <LoaderCircle className="animate-spin" /> : <Receipt />} Create Bill
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
