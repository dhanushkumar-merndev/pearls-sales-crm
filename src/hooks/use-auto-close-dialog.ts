"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type DialogActionState = {
  ok: boolean;
  message?: string;
};

export function useAutoCloseDialog(
  state: DialogActionState,
  fallbackMessage = "Saved successfully.",
) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const handledState = useRef<DialogActionState | null>(null);

  useEffect(() => {
    if (!state.ok) return;

    if (handledState.current !== state) {
      handledState.current = state;
      toast.success(state.message ?? fallbackMessage);
      router.refresh();
    }
    const timer = window.setTimeout(() => setOpen(false), 0);
    return () => window.clearTimeout(timer);
  }, [fallbackMessage, router, state]);

  return { open, setOpen };
}
