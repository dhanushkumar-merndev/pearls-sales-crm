"use client";

import { useState, useTransition } from "react";
import { LoaderCircle, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteMedicine, restoreMedicine } from "./actions";
import type { ActionState } from "@/types/hospital";
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

const idle: ActionState = { ok: false };

/**
 * Both buttons call their action directly instead of going through
 * useActionState + useAutoCloseDialog.
 *
 * The reason is that this control lives in the row it acts on: the action
 * revalidates the directory, that row leaves the refreshed tree, and the
 * button unmounts in the very commit that would have delivered the result.
 * An effect-driven toast therefore never runs, and the outcome matters here --
 * "deleted outright" and "archived, stock kept" are different answers. Raising
 * the toast inside the transition puts it in Sonner's own store before this
 * component can go away.
 */
function useRemovalAction(
  action: (state: ActionState, formData: FormData) => Promise<ActionState>,
  fallback: string,
) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const result = await action(idle, formData);
      if (!result.ok) {
        setError(result.message ?? fallback);
        return;
      }
      toast.success(result.message ?? fallback);
      setOpen(false);
    });
  };
  return { open, setOpen, error, pending, submit };
}

function RemovalError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
      {message}
    </p>
  );
}

/**
 * Removing a medicine from the library.
 *
 * Deliberately not the generic DeleteMasterButton: that one tells the admin a
 * used record cannot be deleted at all, which is exactly the dead end this
 * replaces. Here the database keeps every prescription, bill and ledger row
 * pointing at the medicine and only takes it out of the library, so the
 * wording promises what actually happens.
 */
export function DeleteMedicineButton({ id, label }: { id: string; label: string }) {
  const { open, setOpen, error, pending, submit } = useRemovalAction(
    deleteMedicine,
    "This medicine could not be removed.",
  );
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" />
        }
      >
        <Trash2 /> Delete
      </AlertDialogTrigger>
      <AlertDialogContent>
        <form action={submit} className="contents">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {label} from the library?</AlertDialogTitle>
            <AlertDialogDescription>
              It stops appearing in the directory, in doctor
              autocomplete, and in the stock dashboards. Every past
              prescription, sale, bill and stock ledger entry keeps its record
              exactly as it is, and any counted stock is preserved. A medicine
              that was never used is deleted outright.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <input type="hidden" name="id" value={id} />
          <RemovalError message={error} />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction type="submit" variant="destructive" disabled={pending}>
              {pending ? <LoaderCircle className="animate-spin" /> : <Trash2 />} Remove medicine
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The way back from the Removed view, so a deletion is never a dead end. */
export function RestoreMedicineButton({ id, label }: { id: string; label: string }) {
  const { open, setOpen, error, pending, submit } = useRemovalAction(
    restoreMedicine,
    "This medicine could not be restored.",
  );
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button size="sm" variant="ghost" />}>
        <RotateCcw /> Restore
      </AlertDialogTrigger>
      <AlertDialogContent>
        <form action={submit} className="contents">
          <AlertDialogHeader>
            <AlertDialogTitle>Restore {label}?</AlertDialogTitle>
            <AlertDialogDescription>
              It returns to the library and to autocomplete. Its stock batches
              stay inactive: which of them were already written off before the
              removal is not recorded, so pharmacy re-activates the ones it
              still holds under Stock & Batches.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <input type="hidden" name="id" value={id} />
          <RemovalError message={error} />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction type="submit" disabled={pending}>
              {pending ? <LoaderCircle className="animate-spin" /> : <RotateCcw />} Restore medicine
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
