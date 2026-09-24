import "server-only";

import { createClient } from "@supabase/supabase-js";
import { publicSupabaseEnv, serviceRoleKey } from "@/lib/env";

export function createSupabaseAdminClient() {
  const { url } = publicSupabaseEnv();
  return createClient(url, serviceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
