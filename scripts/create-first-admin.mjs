import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), false);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const fullName = process.env.FIRST_ADMIN_NAME?.trim();
const email = process.env.FIRST_ADMIN_EMAIL?.trim().toLowerCase();
const generatePassword = process.argv.includes("--generate-password");
const credentialsPath = ".env.admin-bootstrap";
if (generatePassword && existsSync(credentialsPath)) throw new Error("The private bootstrap credential file already exists; do not overwrite it.");
const password = generatePassword ? `Pa!9${randomBytes(24).toString("base64url")}` : process.env.FIRST_ADMIN_PASSWORD;

if (!url || !serviceKey || !fullName || !email || !password) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FIRST_ADMIN_NAME, " +
      "FIRST_ADMIN_EMAIL and FIRST_ADMIN_PASSWORD are required.",
  );
}
if (fullName.length < 2) throw new Error("FIRST_ADMIN_NAME must contain at least two characters.");
if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("FIRST_ADMIN_EMAIL is invalid.");
if (
  password.length < 12 ||
  !/[a-z]/.test(password) ||
  !/[A-Z]/.test(password) ||
  !/[0-9]/.test(password) ||
  !/[^A-Za-z0-9]/.test(password)
) {
  throw new Error(
    "FIRST_ADMIN_PASSWORD must be at least 12 characters and include upper-case, " +
      "lower-case, numeric and symbol characters.",
  );
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: existing, error: existingError } = await admin
  .from("profiles")
  .select("id")
  .eq("role", "admin")
  .limit(1);
if (existingError) throw new Error(`Could not inspect profiles: ${existingError.message}`);
if (existing?.length) {
  throw new Error("An admin profile already exists. Create or reactivate later users from Admin -> Users.");
}

// Save a generated credential before the remote write so it remains recoverable
// if the connection drops after the account is created. Never print it to logs.
if (generatePassword) writeFileSync(credentialsPath, `E2E_ADMIN_EMAIL=${email}\nE2E_ADMIN_PASSWORD=${password}\n`, { mode: 0o600, flag: "wx" });
const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: fullName },
  // Roles are read from app_metadata only (see 20260924130000_security_hardening.sql).
  app_metadata: { role: "admin" },
});
if (error || !data.user) throw new Error(`Could not create the first admin: ${error?.message ?? "unknown error"}`);

const userId = data.user.id;
// Auth may insert the user before updating app_metadata. Provision through
// the server-only client explicitly; the insert trigger safely defaults to
// inactive when trusted metadata is not yet present.
const { error: provisionError } = await admin.from("profiles").upsert({
  id: userId, full_name: fullName, email, role: "admin", status: "active",
}, { onConflict: "id" });
if (provisionError) throw new Error("The login was created, but its profile could not be provisioned. Keep the local credential file and repair the profile before retrying.");
const { data: profile, error: profileError } = await admin
  .from("profiles")
  .select("id, role, status")
  .eq("id", userId)
  .maybeSingle();

if (profileError || profile?.role !== "admin" || profile.status !== "active") {
  const { error: rollbackError } = await admin.auth.admin.deleteUser(userId);
  throw new Error(
    `Auth user was created but the admin profile was not verified.${
      rollbackError ? ` Automatic rollback also failed: ${rollbackError.message}` : " The auth user was rolled back."
    }`,
  );
}

const { error: auditError } = await admin.from("audit_logs").insert({
  actor_user_id: userId,
  action: "FIRST_ADMIN_CREATED",
  entity_type: "profile",
  entity_id: userId,
  metadata: { source: "create-first-admin" },
});
if (auditError) console.warn(`Admin created, but the bootstrap audit entry failed: ${auditError.message}`);

console.log(`First admin created successfully for ${email}. ${generatePassword ? "Generated password saved in .env.admin-bootstrap (private, git-ignored)." : "Remove FIRST_ADMIN_PASSWORD from the environment now."}`);
