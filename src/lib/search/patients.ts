import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { EMPTY_UUID } from "@/lib/domain/search";
import { searchDigits } from "@/lib/domain/search";

export async function findMatchingPatientIds(
  supabase: SupabaseClient,
  value: string,
  limit = 50,
) {
  const { data, error } = await supabase.rpc("list_patients", {
    p_query: value,
    p_limit: Math.min(Math.max(limit, 1), 100),
    p_offset: 0,
    p_include_visit_count: false,
    p_active_only: true,
  });
  if (error) throw new Error("Patient search could not be completed.");
  return ((data ?? []) as Array<{ id: string }>).map((patient) => String(patient.id));
}

export async function findMatchingVisitIds(
  supabase: SupabaseClient,
  value: string,
  limit = 100,
) {
  const patientIds = await findMatchingPatientIds(supabase, value, limit);
  const filters = patientIds.length
    ? [`patient_id.in.(${patientIds.join(",")})`]
    : [`patient_id.eq.${EMPTY_UUID}`];
  if (/^#?\d{1,4}$/.test(value.trim())) {
    filters.push(`token_number.eq.${Number(searchDigits(value))}`);
  }

  const { data, error } = await supabase
    .from("visits")
    .select("id")
    .or(filters.join(","))
    .limit(limit);
  if (error) throw new Error("Visit search could not be completed.");
  return (data ?? []).map((visit) => String(visit.id));
}
