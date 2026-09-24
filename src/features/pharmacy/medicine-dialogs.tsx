"use client";

import { useActionState, useState } from "react";
import { LoaderCircle, PackagePlus, Pencil, Plus } from "lucide-react";
import { saveMedicine, saveMedicineBatch } from "./actions";
import type { ActionState } from "@/types/hospital";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useAutoCloseDialog } from "@/hooks/use-auto-close-dialog";
import { DeleteMasterButton } from "@/features/admin/delete-master-button";
import { DeleteMedicineButton } from "./medicine-removal-buttons";
import { calculateStockUnits } from "@/lib/domain/medicine-quantity";
import { LearningField } from "./learning-field";
import {
  emptyFieldOptions,
  type MedicineFieldOptions,
} from "./medicine-field-options";

const initial: ActionState = { ok: false };
export function MedicineDialog({
  item,
  canDelete = false,
  fieldOptions,
}: {
  item?: {
    id: string;
    brandName: string;
    genericName: string | null;
    strength: string | null;
    dosageForm: string;
    manufacturer: string | null;
    active: boolean;
  };
  canDelete?: boolean;
  /** Values the pharmacy has used before, offered as dropdown choices. */
  fieldOptions?: MedicineFieldOptions | undefined;
}) {
  const options = fieldOptions ?? emptyFieldOptions();
  const [state, action, pending] = useActionState(saveMedicine, initial);
  const { open, setOpen } = useAutoCloseDialog(state, "Medicine saved.");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            size={item ? "sm" : "default"}
            variant={item ? "ghost" : "default"}
          />
        }
      >
        {item ? <Pencil /> : <Plus />}
        {item ? "Edit" : "Add Medicine"}
      </DialogTrigger>
      <DialogContent>
        <form action={action} className="contents">
          <DialogHeader>
            <DialogTitle>{item ? "Edit" : "Add"} medicine</DialogTitle>
            <DialogDescription>
              The directory is separate from physical batch stock.
            </DialogDescription>
          </DialogHeader>
          <input type="hidden" name="id" value={item?.id ?? ""} />
          {state.message && !state.ok ? (
            <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {state.message}
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Brand name is the one field with nothing to suggest -- every
                medicine has its own, so a list of previous ones is only in
                the way. The rest repeat across the directory, so they are
                type-or-pick and learn whatever gets typed. */}
            <div className="space-y-2">
              <Label htmlFor="medicine-brandName">Medicine name</Label>
              <Input
                id="medicine-brandName"
                name="brandName"
                defaultValue={item?.brandName ?? ""}
                required
              />
            </div>
            <LearningField
              name="genericName"
              label="Generic name"
              options={options.generic_name}
              defaultValue={item?.genericName ?? ""}
            />
            <LearningField
              name="strength"
              label="Strength"
              options={options.strength}
              defaultValue={item?.strength ?? ""}
              placeholder="500 mg"
            />
            <LearningField
              name="dosageForm"
              label="Dosage form"
              options={options.dosage_form}
              defaultValue={item?.dosageForm ?? ""}
              placeholder="Tablet"
              required
            />
            <LearningField
              name="manufacturer"
              label="Manufacturer"
              options={options.manufacturer}
              defaultValue={item?.manufacturer ?? ""}
            />
            <label className="flex items-center gap-2 self-end text-sm">
              <Checkbox name="active" defaultChecked={item?.active ?? true} />{" "}
              Active
            </label>
          </div>
          <DialogFooter showCloseButton>
            {item && canDelete ? <DeleteMedicineButton id={item.id} label={item.brandName} /> : null}
            <Button disabled={pending} type="submit">
              {pending ? <LoaderCircle className="animate-spin" /> : <Plus />}{" "}
              Save Medicine
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type MedicineOption = { id: string; name: string };
export function BatchDialog({
  medicines,
  item,
  canDelete = false,
}: {
  medicines: MedicineOption[];
  item?: {
    id: string;
    medicineId: string;
    batchNumber: string;
    expiryDate: string;
    purchasePrice: string;
    sellingPrice: string;
    lowStockThreshold: number;
    unitsPerPack: number;
    active: boolean;
  };
  canDelete?: boolean;
}) {
  const [state, action, pending] = useActionState(saveMedicineBatch, initial);
  const [medicineId, setMedicineId] = useState(
    item?.medicineId ?? medicines[0]?.id ?? "",
  );
  const [key] = useState(() => crypto.randomUUID());
  const [unitsPerPack, setUnitsPerPack] = useState(item?.unitsPerPack ?? 1);
  const [packCount, setPackCount] = useState(0);
  const [looseUnits, setLooseUnits] = useState(0);
  const [quantityAdjustment, setQuantityAdjustment] = useState(0);
  const openingUnits = calculateStockUnits(
    unitsPerPack,
    packCount,
    looseUnits,
  ) ?? 0;
  const { open, setOpen } = useAutoCloseDialog(state, "Medicine batch saved.");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            size={item ? "sm" : "default"}
            variant={item ? "ghost" : "outline"}
          />
        }
      >
        {item ? <Pencil /> : <PackagePlus />}
        {item ? "Edit / Adjust" : "Add Batch"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <form action={action} className="contents">
          <DialogHeader>
            <DialogTitle>
              {item ? "Edit batch / adjust stock" : "Add medicine batch"}
            </DialogTitle>
            <DialogDescription>
              Quantity is changed through an atomic stock ledger entry. Use a
              negative adjustment only for a documented correction.
            </DialogDescription>
          </DialogHeader>
          <input type="hidden" name="batchId" value={item?.id ?? ""} />
          <input type="hidden" name="medicineId" value={medicineId} />
          <input type="hidden" name="idempotencyKey" value={key} />
          {/* Stock is held in pieces; this records how many pieces make a pack,
              and the selling price below is the price of one pack. */}
          <input type="hidden" name="unitsPerPack" value={unitsPerPack} />
          {!item ? (
            <input type="hidden" name="quantityDelta" value={openingUnits} />
          ) : null}
          {state.message && !state.ok ? (
            <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {state.message}
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Medicine</Label>
              <Select
                value={medicineId}
                onValueChange={(value) => setMedicineId(value as string)}
                disabled={Boolean(item)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>{() => medicines.find((medicine) => medicine.id === medicineId)?.name ?? "Select medicine"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {medicines.map((medicine) => (
                    <SelectItem key={medicine.id} value={medicine.id} label={medicine.name}>
                      {medicine.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {[
              ["batchNumber", "Batch number", item?.batchNumber ?? "", "text"],
              ["expiryDate", "Expiry date", item?.expiryDate ?? "", "date"],
              [
                "purchasePrice",
                "Purchase price per pack (₹)",
                item?.purchasePrice ?? "0",
                "text",
              ],
              [
                "sellingPrice",
                "Selling price per pack (₹)",
                item?.sellingPrice ?? "",
                "text",
              ],
              [
                "lowStockThreshold",
                "Low stock threshold",
                String(item?.lowStockThreshold ?? 10),
                "number",
              ],
            ].map(([name, label, value, type]) => (
              // Labelled properly: without htmlFor/id these inputs were
              // unreachable by label, for a screen reader as much as a test.
              <div className="space-y-2" key={name}>
                <Label htmlFor={`batch-${name}`}>{label}</Label>
                <Input
                  id={`batch-${name}`}
                  name={name}
                  type={type}
                  defaultValue={value}
                  required
                />
              </div>
            ))}
            {item ? (
              <>
              <div className="space-y-2">
                <Label htmlFor="unitsPerPackEdit">Units per pack</Label>
                <Input
                  id="unitsPerPackEdit"
                  type="number"
                  min={1}
                  step={1}
                  value={unitsPerPack}
                  onChange={(event) => setUnitsPerPack(Number(event.target.value))}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Pieces in one strip / box / bottle. The price above is for one
                  pack; a single piece is priced pro rata.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="quantityDelta">
                  Stock adjustment (individual units)
                </Label>
                <Input
                  id="quantityDelta"
                  name="quantityDelta"
                  type="number"
                  value={quantityAdjustment}
                  onChange={(event) =>
                    setQuantityAdjustment(Number(event.target.value))
                  }
                  required
                />
              </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="packCount">Number of packs</Label>
                  <Input
                    id="packCount"
                    type="number"
                    min={0}
                    step={1}
                    value={packCount}
                    onChange={(event) =>
                      setPackCount(Number(event.target.value))
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="unitsPerPack">Units per pack</Label>
                  <Input
                    id="unitsPerPack"
                    type="number"
                    min={1}
                    step={1}
                    value={unitsPerPack}
                    onChange={(event) =>
                      setUnitsPerPack(Number(event.target.value))
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="looseUnits">Loose units</Label>
                  <Input
                    id="looseUnits"
                    type="number"
                    min={0}
                    step={1}
                    value={looseUnits}
                    onChange={(event) =>
                      setLooseUnits(Number(event.target.value))
                    }
                    required
                  />
                </div>
                <div className="rounded-lg bg-muted p-3 text-sm">
                  <span className="block text-muted-foreground">Opening stock</span>
                  <strong className="text-lg tabular-nums">
                    {openingUnits} individual units
                  </strong>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {packCount} pack{packCount === 1 ? "" : "s"} × {unitsPerPack}
                    {looseUnits ? ` + ${looseUnits} loose` : ""}
                  </span>
                </div>
              </>
            )}
            {item ? (
              <div className="space-y-3 rounded-lg border p-3 sm:col-span-2">
                <div>
                  <p className="font-medium">Pack calculator</p>
                  <p className="text-xs text-muted-foreground">
                    Optional helper for positive restocking. Corrections can
                    still be entered directly above.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="adjustPackCount">Packs to add</Label>
                    <Input
                      id="adjustPackCount"
                      type="number"
                      min={0}
                      step={1}
                      value={packCount}
                      onChange={(event) =>
                        setPackCount(Number(event.target.value))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="adjustUnitsPerPack">Units per pack</Label>
                    <Input
                      id="adjustUnitsPerPack"
                      type="number"
                      min={1}
                      step={1}
                      value={unitsPerPack}
                      onChange={(event) =>
                        setUnitsPerPack(Number(event.target.value))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="adjustLooseUnits">Loose units to add</Label>
                    <Input
                      id="adjustLooseUnits"
                      type="number"
                      min={0}
                      step={1}
                      value={looseUnits}
                      onChange={(event) =>
                        setLooseUnits(Number(event.target.value))
                      }
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2 rounded-md bg-muted p-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm">
                    Calculated adjustment:{" "}
                    <strong className="tabular-nums">+{openingUnits} units</strong>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={openingUnits <= 0}
                    onClick={() => setQuantityAdjustment(openingUnits)}
                  >
                    Use +{openingUnits}
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="reason">Adjustment reason</Label>
              <Input
                id="reason"
                name="reason"
                defaultValue={item ? "Stock count adjustment" : "Opening stock"}
                required
              />
              <p className="text-xs text-muted-foreground">
                Stock is counted in individual pieces (tablets, capsules, ml).
                Prices are for one pack, and a single piece is billed pro rata.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox name="active" defaultChecked={item?.active ?? true} />{" "}
              Active
            </label>
          </div>
          <DialogFooter showCloseButton>
            {item && canDelete ? <DeleteMasterButton entity="medicine_batch" id={item.id} label={`batch ${item.batchNumber}`} /> : null}
            <Button disabled={pending || !medicineId} type="submit">
              {pending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <PackagePlus />
              )}{" "}
              Save Batch
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
