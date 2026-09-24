/**
 * Turns a beta/demo database into a clean production one.
 *
 *   Removes : every patient and everything hanging off them -- visits, tokens,
 *             payments, vitals, consultations, prescriptions, test orders,
 *             report metadata and the uploaded files themselves, pharmacy sales,
 *             stock batches and movements, leads and their activities,
 *             procedure sales, import and export jobs, audit logs, uploaded
 *             files, and all physical stock quantities.
 *
 *   Keeps   : staff accounts and profiles, doctors, departments, charge presets,
 *             report categories, hospital settings, inventory
 *             items, medicine definitions, and clinical directory entries.
 *             Inventory item definitions stay available in dropdowns, but
 *             their opening quantities are reset to zero.
 *
 * Dry run unless --yes is passed, and it refuses to touch a project whose ref
 * does not match --project, because the cost of pointing this at the wrong
 * database is unrecoverable.
 *
 *   pnpm db:clean-demo                       # report only, changes nothing
 *   pnpm db:clean-demo --project <ref> --yes # actually clean
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
  if (match) process.env[match[1]] ??= match[2].replace(/^["']|["']$/g, "");
}

const args = process.argv.slice(2);
const execute = args.includes("--yes");
const projectArg = args[args.indexOf("--project") + 1];
const ref = process.env.SUPABASE_PROJECT_ID;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.SUPABASE_DB_PASSWORD;

if (!ref || !url || !serviceKey || !password) {
  throw new Error("SUPABASE_PROJECT_ID, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_DB_PASSWORD are required.");
}
if (execute && projectArg !== ref) {
  throw new Error(
    `Refusing to clean. Pass --project ${ref} to confirm you mean the database in .env` +
      (projectArg ? ` (got "${projectArg}").` : "."),
  );
}

// Order does not matter: TRUNCATE ... CASCADE resolves the foreign keys, and it
// does not fire the row triggers that keep completed clinical records immutable.
const WIPE = [
  "leads",
  "lead_activities",
  "patients",
  "visits",
  "visit_payments",
  "vitals",
  "consultations",
  "prescriptions",
  "prescription_items",
  "test_orders",
  "patient_reports",
  "pharmacy_sales",
  "pharmacy_sale_items",
  "procedure_sales",
  "procedure_sale_items",
  "medicine_batches",
  "stock_movements",
  "bulk_import_jobs",
  "bulk_import_errors",
  "export_jobs",
  "audit_logs",
  "notification_reads",
  "daily_token_sequences",
];

const KEEP = [
  "profiles",
  "doctors",
  "departments",
  "charges",
  "report_categories",
  "hospital_settings",
  "inventory_items",
  "medicine_directory",
  "clinical_terms",
  "snomed_releases",
  "snomed_concepts",
];
const BUCKETS = ["patient-documents", "hospital-exports"];

const client = new pg.Client({
  connectionString: `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

async function counts(tables) {
  // One connection, so these run in sequence rather than through Promise.all.
  const results = [];
  for (const table of tables) {
    const { rows } = await client.query(`select count(*)::int as n from public.${table}`);
    if (rows[0].n > 0) results.push([table, rows[0].n]);
  }
  return results;
}

const before = await counts(WIPE);
const staff = await client.query("select count(*)::int as n from public.profiles where status = 'active'");
const inventoryWithStock = await client.query("select count(*)::int as n from public.inventory_items where quantity <> 0");
const kept = await counts(KEEP);

console.log(`\nProject: ${ref}`);
console.log(execute ? "Mode:    EXECUTE -- data will be deleted\n" : "Mode:    dry run -- nothing will be changed\n");
console.log("Will be removed:");
for (const [table, n] of before) console.log(`  ${String(n).padStart(7)}  ${table}`);
console.log(`  ${String(inventoryWithStock.rows[0].n).padStart(7)}  inventory item quantities (definitions kept)`);
console.log("\nWill be kept:");
for (const [table, n] of kept) console.log(`  ${String(n).padStart(7)}  ${table}`);
console.log(`  ${String(staff.rows[0].n).padStart(7)}  active staff accounts`);

if (!execute) {
  console.log(`\nNothing was changed. To clean for real:\n  pnpm db:clean-demo --project ${ref} --yes\n`);
  await client.end();
  process.exit(0);
}

// Uploaded patient files live in storage, not Postgres, and would otherwise be
// orphaned copies of real people's reports.
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
let removedFiles = 0;
for (const bucket of BUCKETS) {
  const seen = new Set();
  const files = [];
  const walk = async (prefix) => {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await admin.storage
        .from(bucket)
        .list(prefix, { limit: 1000, offset });
      if (error || !data?.length) break;
      for (const entry of data) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.id) files.push(path);
        else if (!seen.has(path)) {
          seen.add(path);
          await walk(path);
        }
      }
      if (data.length < 1000) break;
    }
  };
  await walk("");
  for (let index = 0; index < files.length; index += 100) {
    const chunk = files.slice(index, index + 100);
    const { error: removeError } = await admin.storage.from(bucket).remove(chunk);
    if (removeError) throw new Error(`Could not clear ${bucket}: ${removeError.message}`);
    removedFiles += chunk.length;
  }
}

await client.query("begin");
await client.query(`truncate table ${WIPE.map((table) => `public.${table}`).join(", ")} restart identity cascade`);
await client.query("update public.inventory_items set quantity = 0, updated_at = now() where quantity <> 0");
await client.query("commit");

const after = await counts(WIPE);
await client.end();

console.log(`\nDone. ${removedFiles} stored file(s) removed.`);
console.log(after.length ? `Rows remaining (unexpected): ${JSON.stringify(after)}` : "All transactional tables are empty.");
console.log(`
Before handing the system over:
  1. Give every staff account its own password (Admin -> Users). The beta
     accounts share one.
  2. Import the hospital's real medicine list (Pharmacy -> Bulk Import) and
     their common diagnoses (Admin -> Clinical Directory).
  3. Confirm Admin -> Settings shows the correct address and phone: they print
     on every token, prescription, bill and discharge summary.
`);
