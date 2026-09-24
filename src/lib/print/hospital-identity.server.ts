import "server-only";
import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { HOSPITAL_IDENTITY_FALLBACK, type HospitalIdentity } from "./hospital-identity";

/**
 * Hospital identity for printed documents. Cached per request so a page that
 * renders several documents (or a document plus its footer) hits the table once.
 * Any blank field falls back to the printed stationery rather than leaving a
 * gap on the paper.
 */
export const getHospitalIdentity = cache(async (): Promise<HospitalIdentity> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("hospital_settings")
    .select("hospital_name,tagline,address,phone,email")
    .eq("id", true)
    .maybeSingle();
  if (!data) return HOSPITAL_IDENTITY_FALLBACK;
  return {
    name: data.hospital_name || HOSPITAL_IDENTITY_FALLBACK.name,
    tagline: data.tagline || HOSPITAL_IDENTITY_FALLBACK.tagline,
    address: data.address || HOSPITAL_IDENTITY_FALLBACK.address,
    phone: data.phone || HOSPITAL_IDENTITY_FALLBACK.phone,
    email: data.email || HOSPITAL_IDENTITY_FALLBACK.email,
  };
});
