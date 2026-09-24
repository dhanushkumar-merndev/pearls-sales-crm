import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd(), false);

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_APP_URL",
  "APP_TIMEZONE",
  "PATIENT_DOCUMENT_MAX_BYTES",
  "EXPORT_RETENTION_DAYS",
];
const problems = [];
const isLocal = (hostname) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

for (const name of required) {
  if (!process.env[name]?.trim()) problems.push(`${name} is required.`);
}

const validateUrl = (name, value) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && !isLocal(url.hostname)) {
      problems.push(`${name} must use HTTPS outside localhost.`);
    }
    return url;
  } catch {
    problems.push(`${name} must be a valid URL.`);
    return null;
  }
};

if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
  validateUrl("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
}
if (process.env.NEXT_PUBLIC_APP_URL) {
  const appUrl = validateUrl("NEXT_PUBLIC_APP_URL", process.env.NEXT_PUBLIC_APP_URL);
  if (appUrl && (appUrl.pathname !== "/" || appUrl.search || appUrl.hash)) {
    problems.push("NEXT_PUBLIC_APP_URL must be an origin without a path, query, or fragment.");
  }
}

if (
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY === process.env.SUPABASE_SERVICE_ROLE_KEY
) {
  problems.push("The Supabase anon key and service-role key must be different.");
}

if (process.env.APP_TIMEZONE) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: process.env.APP_TIMEZONE }).format();
  } catch {
    problems.push("APP_TIMEZONE must be a valid IANA time zone.");
  }
}

const maxBytes = Number(process.env.PATIENT_DOCUMENT_MAX_BYTES);
if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 1_048_576) {
  problems.push("PATIENT_DOCUMENT_MAX_BYTES must be an integer from 1 to 1048576.");
}

const retentionDays = Number(process.env.EXPORT_RETENTION_DAYS);
if (!Number.isInteger(retentionDays) || retentionDays < 0) {
  problems.push("EXPORT_RETENTION_DAYS must be a non-negative integer.");
}

if (Boolean(process.env.WHOS_CLIENT?.trim()) !== Boolean(process.env.WHOS_SECRET?.trim())) {
  problems.push("WHOS_CLIENT and WHOS_SECRET must either both be set or both be empty.");
}

if (problems.length) {
  console.error(`Production environment check failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}

console.log("Production environment check passed. No secret values were printed.");
