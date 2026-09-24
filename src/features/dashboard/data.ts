import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/hospital";

export type DashboardSummary = Record<string, number>;

/** Row shape returned by the list_pending_prescriptions RPC. */
export type PendingPrescriptionRow = {
  id: string;
  prescription_number: number;
  status: string;
  created_at: string;
  expires_at: string;
  token_number: number | null;
  source: string;
  patient_name: string | null;
  patient_phone: string | null;
  doctor_name: string | null;
  items: Array<{ id: string }>;
};

export type DashboardLeadRow = {
  id: string;
  full_name: string | null;
  phone_normalized: string | null;
  procedure_interest: string | null;
  status: string;
  next_follow_up_at: string | null;
  received_at: string;
};

export async function getDashboardData(profile: Profile) {
  const supabase = await createSupabaseServerClient();
  // Prescription expiry is swept by the Supabase pg_cron job
  // "expire-stale-hospital-prescriptions" (every minute), not per dashboard load.
  const summaryPromise = supabase.rpc("dashboard_summary");
  if (profile.role === "pharmacy") {
    // Via RPC: the pharmacy role has no SELECT on public.patients, so an
    // embedded patient join resolves to null and every name renders as "—".
    const [summaryResult, result] = await Promise.all([summaryPromise, supabase.rpc("list_pending_prescriptions", { p_query: null, p_limit: 8 })]);
    return { summary: (summaryResult.data ?? {}) as DashboardSummary, role: profile.role, activity: { kind: "pharmacy" as const, rows: (result.data ?? []) as PendingPrescriptionRow[] } };
  }
  if (profile.role === "sales_executive") {
    // RLS limits a sales executive to the leads assigned to them, so this is
    // "my next calls": follow-ups due first, then the newest untouched leads.
    const [summaryResult, result] = await Promise.all([
      summaryPromise,
      supabase
        .from("leads")
        .select("id,full_name,phone_normalized,procedure_interest,status,next_follow_up_at,received_at")
        .in("status", ["new", "contacted", "interested"])
        .order("next_follow_up_at", { ascending: true, nullsFirst: false })
        .order("received_at", { ascending: false })
        .limit(10),
    ]);
    return {
      summary: (summaryResult.data ?? {}) as DashboardSummary,
      role: profile.role,
      activity: { kind: "leads" as const, rows: (result.data ?? []) as DashboardLeadRow[] },
    };
  }
  // Today only: a visit from a prior day is stale (already auto-cancelled if
  // it was still waiting -- see the expire-stale-hospital-visits cron job)
  // and showing it here just looks like yesterday's queue never cleared.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const [summaryResult, visitsResult] = await Promise.all([
    summaryPromise,
    supabase
      .from("visits")
      .select("id, token_number, visit_type, status, created_at, patients(name), doctors(display_name)")
      .eq("visit_date", today)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  return {
    summary: (summaryResult.data ?? {}) as DashboardSummary,
    activity: { kind: "visits" as const, rows: (visitsResult.data ?? []) as unknown as Array<{
      id: string;
      token_number: number;
      visit_type: string;
      status: string;
      created_at: string;
      patients: { name: string } | null;
      doctors: { display_name: string } | null;
    }> },
    role: profile.role,
  };
}
