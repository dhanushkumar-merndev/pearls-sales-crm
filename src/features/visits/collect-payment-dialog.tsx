"use client";
import { useActionState, useState } from "react";
import { IndianRupee, LoaderCircle } from "lucide-react";
import { addVisitPayment } from "./actions";
import { formatInr } from "@/lib/domain/money";
import type { ActionState } from "@/types/hospital";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { useAutoCloseDialog } from "@/hooks/use-auto-close-dialog";

const initial: ActionState = { ok: false };
const MODE_LABELS: Record<string, string> = { cash: "Cash", upi: "UPI", card: "Card", bank_transfer: "Bank Transfer", other: "Other" };

/**
 * Settles a visit's fee when it never reaches the pharmacy counter (no
 * medicines were prescribed, e.g. a procedure consultation) -- the
 * only other place this fee is ever collected is bundled into dispensing.
 */
export function CollectPaymentDialog({
  visitId,
  patientId,
  balancePaise,
  size = "sm",
}: {
  visitId: string;
  /** Only used to revalidate that patient's page; safe to omit when unknown. */
  patientId?: string;
  balancePaise: number;
  size?: "sm" | "default";
}) {
  const [state, action, pending] = useActionState(addVisitPayment, initial);
  const [amount, setAmount] = useState(() => (balancePaise / 100).toFixed(2));
  const [mode, setMode] = useState("cash");
  const [key] = useState(() => crypto.randomUUID());
  const { open, setOpen } = useAutoCloseDialog(state, "Payment recorded.");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size={size} />}>
        <IndianRupee /> Collect {formatInr(balancePaise)}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form action={action} className="contents">
          <DialogHeader>
            <DialogTitle>Collect payment</DialogTitle>
            <DialogDescription>
              Outstanding balance {formatInr(balancePaise)}.
            </DialogDescription>
          </DialogHeader>
          <input type="hidden" name="visitId" value={visitId} />
          <input type="hidden" name="patientId" value={patientId ?? ""} />
          <input type="hidden" name="idempotencyKey" value={key} />
          <input type="hidden" name="mode" value={mode} />
          {state.message && !state.ok ? (
            <Alert variant="destructive">
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="collect-amount">Amount (₹)</Label>
            <Input
              id="collect-amount"
              name="amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <p className="text-xs text-destructive">{state.fieldErrors?.amount?.[0]}</p>
          </div>
          <div className="space-y-2">
            <Label>Payment mode</Label>
            <Select value={mode} onValueChange={(v) => setMode(String(v))}>
              <SelectTrigger className="w-full">
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
          <div className="space-y-2">
            <Label htmlFor="collect-reference">Reference (optional)</Label>
            <Input id="collect-reference" name="reference" placeholder="UPI ref / cheque no." />
          </div>
          <DialogFooter showCloseButton>
            <Button disabled={pending} type="submit">
              {pending ? <LoaderCircle className="animate-spin" /> : <IndianRupee />} Record Payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
