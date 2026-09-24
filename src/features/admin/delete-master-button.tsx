"use client";

import { useState, useTransition } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteMasterRecord } from "@/features/admin/master-actions";
import type { ActionState } from "@/types/hospital";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Entity = "department" | "charge" | "report_category" | "clinical_term" | "room_bed" | "medicine_batch" | "doctor";

/**
 * The toast is raised inside the transition rather than from an effect: this
 * button lives in the row it removes, so the row leaves the revalidated tree
 * and unmounts the component in the same commit that would have delivered the
 * result. The outcome matters here -- "deleted outright" and "kept, because
 * history uses it" are different answers.
 */
export function DeleteMasterButton({ entity, id, label }: { entity: Entity; id: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const result: ActionState = await deleteMasterRecord({ ok: false }, formData);
      if (!result.ok) { setError(result.message ?? "This record could not be removed."); return; }
      toast.success(result.message ?? "Removed.");
      setOpen(false);
    });
  };
  return <AlertDialog open={open} onOpenChange={setOpen}>
    <AlertDialogTrigger render={<Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" />}><Trash2 /> Delete</AlertDialogTrigger>
    <AlertDialogContent>
      <form action={submit} className="contents">
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {label}?</AlertDialogTitle>
          <AlertDialogDescription>
            It stops appearing in this list and anywhere staff pick from it.
            Every record that already uses it -- past visits, prescriptions,
            bills, reports -- keeps its history exactly as it is. A record that
            was never used is deleted outright.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <input type="hidden" name="entity" value={entity} />
        <input type="hidden" name="id" value={id} />
        {error ? <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction type="submit" variant="destructive" disabled={pending}>{pending ? <LoaderCircle className="animate-spin" /> : <Trash2 />} Remove</AlertDialogAction>
        </AlertDialogFooter>
      </form>
    </AlertDialogContent>
  </AlertDialog>;
}

/** Removing a staff account: deactivated once they have recorded anything. */
export function DeleteStaffButton({ id, label }: { id: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const { deleteStaffUser } = await import("@/features/admin/master-actions");
      const result: ActionState = await deleteStaffUser({ ok: false }, formData);
      if (!result.ok) { setError(result.message ?? "This account could not be removed."); return; }
      toast.success(result.message ?? "Account removed.");
      setOpen(false);
    });
  };
  return <AlertDialog open={open} onOpenChange={setOpen}>
    <AlertDialogTrigger render={<Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" />}><Trash2 /> Remove</AlertDialogTrigger>
    <AlertDialogContent>
      <form action={submit} className="contents">
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {label}?</AlertDialogTitle>
          <AlertDialogDescription>
            They are signed out and can no longer sign in. Everything they
            already recorded -- patients registered, payments collected, audit
            entries -- keeps their name on it, because that is the record of
            who did the work. An account that has never been used is deleted
            outright.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <input type="hidden" name="id" value={id} />
        {error ? <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction type="submit" variant="destructive" disabled={pending}>{pending ? <LoaderCircle className="animate-spin" /> : <Trash2 />} Remove account</AlertDialogAction>
        </AlertDialogFooter>
      </form>
    </AlertDialogContent>
  </AlertDialog>;
}
