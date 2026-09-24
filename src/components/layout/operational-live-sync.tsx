"use client";

import { useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { AppRole } from "@/types/hospital";

// medicine_directory is watched by every clinical role because each reads it
// somewhere: pharmacy and admin manage the library, doctors prescribe from its
// autocomplete, and reception/OP read it on Drug Stock. Without it, an admin
// removing a medicine left those screens still offering it until someone
// reloaded. It is a rare write, so the extra subscription costs almost
// nothing -- unlike medicine_batches, which changes on every dispense and
// stays with the two roles that manage stock. `leads` lets a new Meta lead
// appear for its sales executive (and admin) without a reload.
const roleTables: Record<AppRole, string[]> = {
  admin: ["visits", "patient_reports", "prescriptions", "medicine_batches", "medicine_directory", "leads"],
  reception: ["visits", "vitals", "visit_payments", "patient_reports", "consultations", "medicine_directory", "leads"],
  op: ["visits", "vitals", "patient_reports", "medicine_directory"],
  doctor: ["visits", "consultations", "patient_reports", "medicine_directory"],
  pharmacy: ["prescriptions", "medicine_batches", "pharmacy_sales", "medicine_directory"],
  sales_executive: ["leads", "lead_activities"],
};

export function OperationalLiveSync({ role }: { role: AppRole }) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const previous = useRef<string | undefined>(undefined);
  const queryKey = useMemo(() => ["operational-version", role] as const, [role]);
  const { data } = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/live/version", { signal, cache: "no-store" });
      if (!response.ok) throw new Error("Live refresh unavailable");
      return (await response.json()) as { signature: string };
    },
    // Realtime below is the primary freshness signal. This poll is only a
    // safety net for a dropped websocket, so it runs every 10 minutes rather
    // than every minute: at 60s it was ~9,600 needless function invocations a
    // day across 20 staff, for data realtime had already delivered.
    refetchInterval: 600_000,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (!data?.signature) return;
    if (previous.current && previous.current !== data.signature) router.refresh();
    previous.current = data.signature;
  }, [data?.signature, router]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let cancelled = false;
    let channel = supabase.channel(`operations:${role}`);
    // router.refresh() re-runs the whole server component tree, so firing it
    // per row was expensive: one pharmacy dispense touches prescriptions,
    // prescription_items and a batch row, and every watched table change hit
    // every signed-in user of that role. Bursts are coalesced into one refresh.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey });
        void queryClient.invalidateQueries({ queryKey: ["hospital-notifications"] });
        if (document.visibilityState === "visible") router.refresh();
      }, 2_000);
    };
    // A stock tab can be hidden while dispensing happens in another tab. The
    // realtime event above still invalidates its signature, but intentionally
    // avoids rendering a hidden page. Recheck on focus/visibility so the old
    // quantity can never remain on screen when staff return to that tab. The
    // signature comparison refreshes the page only when operational data
    // actually changed.
    const syncWhenVisible = () => {
      if (document.visibilityState !== "visible") return;
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({
        queryKey: ["hospital-notifications"],
      });
    };
    document.addEventListener("visibilitychange", syncWhenVisible);
    window.addEventListener("focus", syncWhenVisible);
    for (const table of roleTables[role]) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        scheduleRefresh,
      );
    }
    // Realtime evaluates row level security as whoever the SOCKET is
    // authenticated as, not as whoever is signed in to the app. Without this
    // the socket stays on the anon key: it connects, it reports "Subscribed to
    // PostgreSQL", and then every row is filtered out by RLS, so no change
    // ever arrives and the screen only updates on the 10-minute safety poll.
    // Handing realtime the user's access token first is what makes the
    // subscription actually deliver anything.
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (cancelled) return;
      if (token) supabase.realtime.setAuth(token);
      channel.subscribe();
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", syncWhenVisible);
      window.removeEventListener("focus", syncWhenVisible);
      void supabase.removeChannel(channel);
    };
  }, [pathname, queryClient, queryKey, role, router]);

  return null;
}
