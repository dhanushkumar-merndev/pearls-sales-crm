import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/env";
import { APP_ROLES, type AppRole, type Profile } from "@/types/hospital";
import { canAccessRoute, hasPermission, type Permission } from "./permissions";

/**
 * The signed-in user's id, verified without a network round trip where the
 * project publishes a JWKS key.
 *
 * getUser() asks the auth server to validate the token on every request, which
 * cost ~150-200ms on each page load and each poll. getClaims() checks the
 * signature locally against the project's public key instead, and only falls
 * back to the network when the token cannot be verified that way (a legacy
 * shared-secret project, or a key rotation the client has not seen yet).
 *
 * This does NOT change where authorisation comes from: the role is still read
 * from the profiles table below, so revoking someone's access still takes
 * effect on their very next request rather than when their token expires.
 */
async function verifiedUserId(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    const sub = data?.claims?.sub;
    if (!error && typeof sub === "string" && sub) return sub;
  } catch {
    // Fall through to the authoritative network check.
  }
  const { data, error } = await supabase.auth.getUser();
  return error || !data.user ? null : data.user.id;
}

export const getCurrentProfile = cache(async (): Promise<Profile> => {
  if (!hasSupabaseEnv()) redirect("/setup");
  const supabase = await createSupabaseServerClient();
  const userId = await verifiedUserId(supabase);
  if (!userId) redirect("/login");

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, status, doctor_id")
    .eq("id", userId)
    .single();

  if (error || !data || data.status !== "active") redirect("/login?inactive=1");
  if (!APP_ROLES.includes(data.role as AppRole)) redirect("/login?invalidRole=1");

  return {
    id: data.id,
    fullName: data.full_name,
    email: data.email,
    role: data.role as AppRole,
    status: data.status,
    doctorId: data.doctor_id,
  };
});

export async function requirePermission(permission: Permission) {
  const profile = await getCurrentProfile();
  if (!hasPermission(profile.role, permission)) throw new Error("Forbidden");
  return profile;
}

/**
 * Permission guard for route handlers.
 *
 * requirePermission throws, and a thrown Error inside a route handler is an
 * unhandled exception: the caller got HTTP 500 for what is simply "you are not
 * allowed", which reads as an outage in logs and monitoring. This returns the
 * profile, or a 403 response for the handler to return as-is.
 */
export async function requireApiPermission(permission: Permission) {
  const profile = await getCurrentProfile();
  if (!hasPermission(profile.role, permission))
    return {
      profile: null,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    } as const;
  return { profile, response: null } as const;
}

export async function requireRoute(pathname: string) {
  const profile = await getCurrentProfile();
  if (!canAccessRoute(profile.role, pathname)) redirect("/dashboard?forbidden=1");
  return profile;
}
