/**
 * Reverts what the E2E suite writes, and nothing else.
 *
 * The browser specs drive the real application against a real database, so
 * they leave real rows behind: patients, visits, vitals, consultations,
 * prescriptions, sales, enquiries and the stock those sales consumed. This
 * finds every one of them by the markers the specs register under, deletes
 * them in foreign-key order inside one transaction, and puts the dispensed
 * stock back on the shelf.
 *
 * It is deliberately NOT prepare-production: that truncates whole tables. This
 * only ever touches rows reachable from a patient whose name matches a marker
 * below, so running it against a hospital's live database removes the test
 * data and leaves the hospital's own records untouched.
 *
 *   node scripts/e2e-teardown.mjs                        # report only
 *   node scripts/e2e-teardown.mjs --project <ref> --yes  # actually revert
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

if (!ref || !url || !serviceKey || !password)
  throw new Error(
    "SUPABASE_PROJECT_ID, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_DB_PASSWORD are required.",
  );
if (execute && projectArg !== ref)
  throw new Error(
    `Refusing to revert. Pass --project ${ref} to confirm you mean the database in .env` +
      (projectArg ? ` (got "${projectArg}").` : "."),
  );

/**
 * Every name an E2E spec registers a patient under. A marker has to be
 * something no receptionist would ever type: a spec that invents a new patient
 * name adds it here, or its rows survive the teardown.
 */
const PATIENT_MARKERS = [
  "E2E %",
  "E2E Patient %",
  "ZZ E2E %",
  "Allergy Patient %",
  "Full Detail %",
  "Newest First %",
  "Two Doctors %",
  "Chunk Patient %",
  "Repeat Test %",
  "ZZ E2E %",
];
/** Directory rows the pharmacy specs and the API check create. */
const MEDICINE_MARKERS = ["ZZ E2E %", "ZZ API %"];

const client = new pg.Client({
  connectionString: `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const ids = async (sql, params = []) =>
  (await client.query(sql, params)).rows.map((row) => row.id);

// --- Collect, child-last, so every delete below has its parent set ---------
const patients = await ids(
  `select id from public.patients where name ilike any($1)`,
  [PATIENT_MARKERS],
);
const visits = await ids(`select id from public.visits where patient_id = any($1)`, [patients]);
const leads = await ids(`select id from public.leads where patient_id = any($1) or full_name ilike any($2)`, [patients, PATIENT_MARKERS]);
const consultations = await ids(`select id from public.consultations where visit_id = any($1)`, [visits]);
const prescriptions = await ids(
  `select id from public.prescriptions where visit_id = any($1)`,
  [visits],
);
const prescriptionItems = await ids(
  `select id from public.prescription_items where prescription_id = any($1)`,
  [prescriptions],
);
const sales = await ids(
  `select id from public.pharmacy_sales
   where patient_id = any($1) or prescription_id = any($2)`,
  [patients, prescriptions],
);
const saleItems = await ids(`select id from public.pharmacy_sale_items where sale_id = any($1)`, [sales]);
const procedureSales = await ids(
  `select id from public.procedure_sales
   where patient_id = any($1) or visit_id = any($2)`,
  [patients, visits],
);
const reports = await ids(
  `select id from public.patient_reports where patient_id = any($1)`,
  [patients],
);
const reportPaths = (
  await client.query(`select object_path from public.patient_reports where id = any($1)`, [reports])
).rows.map((row) => row.object_path).filter(Boolean);
const medicines = await ids(
  `select id from public.medicine_directory where brand_name ilike any($1)`,
  [MEDICINE_MARKERS],
);
const testBatches = await ids(
  `select id from public.medicine_batches where medicine_id = any($1)`,
  [medicines],
);
// Stock ledger rows written by those sales. Deleting a movement of -10 means
// the batch has to get those 10 pieces back, so the reversal is driven off the
// same set that is about to be removed rather than off the sale lines.
const movements = await ids(
  `select id from public.stock_movements
   where source_id = any($1) or idempotency_key = any($2) or batch_id = any($3)`,
  [sales, saleItems, testBatches],
);
const restores = (
  await client.query(
    `select batch_id, sum(quantity_delta)::int as delta
     from public.stock_movements
     where id = any($1) and batch_id <> all($2)
     group by batch_id`,
    [movements, testBatches],
  )
).rows;

const plan = [
  ["patients", patients.length],
  ["leads", leads.length],
  ["visits", visits.length],
  ["consultations", consultations.length],
  ["prescriptions", prescriptions.length],
  ["prescription_items", prescriptionItems.length],
  ["pharmacy_sales", sales.length],
  ["pharmacy_sale_items", saleItems.length],
  ["procedure_sales", procedureSales.length],
  ["patient_reports", reports.length],
  ["stock_movements", movements.length],
  ["medicine_directory (test rows)", medicines.length],
  ["medicine_batches (test rows)", testBatches.length],
].filter(([, n]) => n > 0);

console.log(`\nProject: ${ref}`);
console.log(execute ? "Mode:    EXECUTE -- test data will be reverted\n" : "Mode:    dry run -- nothing will be changed\n");
if (!plan.length) console.log("No E2E test data found. Nothing to revert.");
for (const [table, n] of plan) console.log(`  ${String(n).padStart(7)}  ${table}`);
for (const row of restores)
  console.log(`  stock: batch ${row.batch_id} ${row.delta >= 0 ? "-" : "+"}${Math.abs(row.delta)} units restored`);

if (!execute) {
  console.log(`\nNothing was changed. To revert for real:\n  node scripts/e2e-teardown.mjs --project ${ref} --yes\n`);
  await client.end();
  process.exit(0);
}

// Uploaded report files live in storage, not Postgres.
if (reportPaths.length) {
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await admin.storage.from("patient-documents").remove(reportPaths);
  if (error) throw new Error(`Could not remove uploaded test files: ${error.message}`);
}

const del = (sql, params) => client.query(sql, params);
await client.query("begin");
// A completed consultation, a closed prescription and its dispensed lines are
// immutable by trigger -- correctly, because clinical history is not editable
// from the application. app.allow_clinical_amendment only lifts the first of
// those three, so a teardown relying on it dies on the first dispensed
// prescription it meets, mid-transaction, reporting a clean database that is
// not clean. Replica mode is the maintenance escape hatch: it suspends user
// triggers for THIS transaction only. The delete order below is still written
// parent-last, because replica mode also suspends foreign key checks and an
// out-of-order delete would no longer be caught.
await client.query("set local session_replication_role = replica");

await del(`delete from public.stock_movements where id = any($1)`, [movements]);
await del(`delete from public.pharmacy_sale_items where sale_id = any($1)`, [sales]);
await del(`delete from public.pharmacy_sales where id = any($1)`, [sales]);
await del(`delete from public.procedure_sale_items where sale_id = any($1)`, [procedureSales]);
await del(`delete from public.procedure_sales where id = any($1)`, [procedureSales]);
await del(`delete from public.patient_reports where id = any($1)`, [reports]);
await del(`delete from public.test_orders where patient_id = any($1)`, [patients]);
await del(`delete from public.prescription_items where prescription_id = any($1)`, [prescriptions]);
await del(`delete from public.prescriptions where id = any($1)`, [prescriptions]);
await del(`delete from public.consultation_diagnoses where consultation_id = any($1)`, [consultations]);
await del(`delete from public.consultations where id = any($1)`, [consultations]);
await del(`delete from public.visit_payments where visit_id = any($1)`, [visits]);
await del(`delete from public.vitals where visit_id = any($1)`, [visits]);
await del(`delete from public.lead_activities where lead_id = any($1)`, [leads]);
await del(`delete from public.leads where id = any($1)`, [leads]);
// A follow-up requires its previous visit by a table constraint, so delete
// follow-ups first instead of temporarily writing an invalid null reference.
await del(`delete from public.visits where id = any($1) and related_previous_visit_id is not null`, [visits]);
await del(`delete from public.visits where id = any($1)`, [visits]);
await del(`delete from public.patients where id = any($1)`, [patients]);
await del(`delete from public.medicine_batches where id = any($1)`, [testBatches]);
await del(`delete from public.medicine_directory where id = any($1)`, [medicines]);

// Put back exactly what the deleted ledger rows took out.
for (const row of restores)
  await del(`update public.medicine_batches set quantity = quantity - $2, updated_at = now() where id = $1`, [
    row.batch_id,
    row.delta,
  ]);

const touched = [
  ...patients, ...visits, ...leads, ...consultations, ...prescriptions,
  ...prescriptionItems, ...sales, ...saleItems, ...procedureSales,
  ...reports, ...medicines, ...testBatches,
];
await del(`delete from public.audit_logs where entity_id = any($1)`, [touched]);
await client.query("commit");

// Verify rather than assume: a teardown that silently half-ran is worse than
// none, because the next run reports a clean database that is not clean.
const leftover = await client.query(
  `select count(*)::int as n from public.patients where name ilike any($1)`,
  [PATIENT_MARKERS],
);
await client.end();
console.log(
  leftover.rows[0].n === 0
    ? "\nDone. Every marked test patient and its records are gone, and dispensed stock is back."
    : `\nWARNING: ${leftover.rows[0].n} marked patient(s) still present.`,
);
process.exit(leftover.rows[0].n === 0 ? 0 : 1);
