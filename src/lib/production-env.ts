const REQUIRED_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_APP_URL",
  "APP_TIMEZONE",
  "PATIENT_DOCUMENT_MAX_BYTES",
  "EXPORT_RETENTION_DAYS",
] as const;

function isLocalHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function validateUrl(name: string, value: string, problems: string[]) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && !isLocalHostname(parsed.hostname)) {
      problems.push(`${name} must use HTTPS outside localhost.`);
    }
    return parsed;
  } catch {
    problems.push(`${name} must be a valid URL.`);
    return null;
  }
}

export function productionEnvironmentProblems(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const problems: string[] = [];

  for (const name of REQUIRED_ENV) {
    if (!env[name]?.trim()) problems.push(`${name} is required.`);
  }

  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (supabaseUrl) validateUrl("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl, problems);

  const appUrl = env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) {
    const parsed = validateUrl("NEXT_PUBLIC_APP_URL", appUrl, problems);
    if (parsed && (parsed.pathname !== "/" || parsed.search || parsed.hash)) {
      problems.push("NEXT_PUBLIC_APP_URL must be an origin without a path, query, or fragment.");
    }
  }

  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (anonKey && serviceKey && anonKey === serviceKey) {
    problems.push("The Supabase anon key and service-role key must be different.");
  }

  const timezone = env.APP_TIMEZONE?.trim();
  if (timezone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    } catch {
      problems.push("APP_TIMEZONE must be a valid IANA time zone.");
    }
  }

  const maxBytes = Number(env.PATIENT_DOCUMENT_MAX_BYTES);
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 1_048_576) {
    problems.push("PATIENT_DOCUMENT_MAX_BYTES must be an integer from 1 to 1048576.");
  }

  const retentionDays = Number(env.EXPORT_RETENTION_DAYS);
  if (!Number.isInteger(retentionDays) || retentionDays < 0) {
    problems.push("EXPORT_RETENTION_DAYS must be a non-negative integer.");
  }

  const hasWhoClient = Boolean(env.WHOS_CLIENT?.trim());
  const hasWhoSecret = Boolean(env.WHOS_SECRET?.trim());
  if (hasWhoClient !== hasWhoSecret) {
    problems.push("WHOS_CLIENT and WHOS_SECRET must either both be set or both be empty.");
  }

  return problems;
}

export function assertProductionEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const problems = productionEnvironmentProblems(env);
  if (problems.length) {
    throw new Error(`Invalid production environment:\n- ${problems.join("\n- ")}`);
  }
}
