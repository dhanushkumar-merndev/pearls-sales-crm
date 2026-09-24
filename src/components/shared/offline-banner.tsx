"use client";

import { useSyncExternalStore } from "react";
import { WifiOff } from "lucide-react";

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/**
 * Replaces the browser's own "no internet" screen with an in-app banner:
 * pages already cached still work, so the honest message is "you're
 * offline, some actions won't work" rather than a dead end.
 *
 * useSyncExternalStore (not state+effect) on purpose: navigator.onLine has
 * no value during SSR, and a state+effect version would render "online" on
 * the server then flip to "offline" after hydration if the client actually
 * is offline -- a real hydration mismatch, not just a cosmetic flash. The
 * server snapshot below is what SSR and the pre-hydration client paint both
 * use, so there is nothing to reconcile.
 */
export function OfflineBanner() {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );

  if (online) return null;
  return (
    <div className="flex items-center justify-center gap-2 bg-amber-500/90 px-4 py-1.5 text-center text-xs font-medium text-white">
      <WifiOff className="size-3.5" />
      You&apos;re offline -- showing the last saved data. Dispensing, payments
      and saving forms need a connection.
    </div>
  );
}
