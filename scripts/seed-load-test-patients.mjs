/**
 * Load-test seed: adds 100,000 synthetic patients for performance testing
 * (search, pagination, dashboard aggregate queries) at scale.
 *
 * Additive only -- unlike seed-demo-data.mjs, this never truncates or
 * touches existing data. Safe to run against a database that already has
 * real records; every row is a plain insert with ON CONFLICT DO NOTHING
 * on the unique phone number, so a rare collision is skipped, not fatal.
 *
 * Patients only -- no visits/consultations/prescriptions are generated for
 * them, by design (this is for query/index performance, not a realistic
 * clinical demo; use seed-demo-data.mjs for that, on a disposable database).
 *
 * Requires SUPABASE_PROJECT_ID, SUPABASE_DB_PASSWORD, NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY (all already in .env).
 *   node scripts/seed-load-test-patients.mjs [count]
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { Client } from "pg";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const TOTAL = Number(process.argv[2]) || 100_000;
const BATCH_SIZE = 2000;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const pw = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD ?? "");
const ref = process.env.SUPABASE_PROJECT_ID;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
if (!pw || !ref) throw new Error("SUPABASE_DB_PASSWORD and SUPABASE_PROJECT_ID are required.");

const db = createClient(url, key, { auth: { persistSession: false } });

// patients.created_by is NOT NULL and FK'd to profiles -- a direct pg
// connection has no auth.uid() session to default it from, so an existing
// profile is picked explicitly. Any active staff account works; the row
// only needs to satisfy the foreign key, not represent who "really" did it.
const { data: profiles, error: profileError } = await db.from("profiles").select("id,role").eq("status", "active").limit(1);
if (profileError) throw new Error(`Could not read profiles: ${profileError.message}`);
if (!profiles?.length) throw new Error("No active staff profile found -- create one before seeding.");
const createdBy = profiles[0].id;

const FIRST = ["Rajesh", "Priya", "Karthik", "Lakshmi", "Suresh", "Meena", "Arun", "Divya", "Ganesh", "Kavitha", "Murugan", "Anitha", "Vijay", "Revathi", "Saravanan", "Deepa", "Ramesh", "Sangeetha", "Bala", "Nithya", "Prakash", "Uma", "Selvam", "Geetha", "Manoj", "Shalini", "Ravi", "Poornima", "Dinesh", "Bhavani"];
const LAST = ["Kumar", "Raman", "Krishnan", "Subramani", "Natarajan", "Pillai", "Iyer", "Nair", "Reddy", "Chandran", "Murthy", "Venkatesh", "Sekar", "Rajan", "Mohan"];
const BLOOD = ["A+", "B+", "O+", "AB+", "A-", "O-", null];
const PLACES = ["Ramanathapuram", "Paramakudi", "Mudukulathur", "Kamuthi", "Uchipuli", "Thondi", "Sayalkudi", "Kadaladi"];
const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr, i) => arr[i % arr.length];

const pg = new Client({
  connectionString: `postgresql://postgres.${ref}:${pw}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await pg.connect();

console.log(`Seeding ${TOTAL.toLocaleString("en-IN")} load-test patients (additive, no existing data touched)...`);

const usedPhones = new Set();
function uniquePhone() {
  // 10-digit number starting 6-9 (the same shape phone_normalized's check
  // constraint requires). ~4 billion possible values for 100k rows, so a
  // plain retry-on-collision loop never meaningfully spins.
  let phone;
  do {
    phone = `${6 + rand(4)}${String(rand(1_000_000_000)).padStart(9, "0")}`;
  } while (usedPhones.has(phone));
  usedPhones.add(phone);
  return phone;
}

const startedAt = Date.now();
let inserted = 0;
for (let batchStart = 0; batchStart < TOTAL; batchStart += BATCH_SIZE) {
  const size = Math.min(BATCH_SIZE, TOTAL - batchStart);
  const rows = [];
  for (let i = 0; i < size; i++) {
    const n = batchStart + i;
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - (1 + rand(80)));
    dob.setMonth(rand(12));
    dob.setDate(1 + rand(28));
    rows.push([
      uniquePhone(),
      `${pick(FIRST, n * 7 + rand(30))} ${pick(LAST, n * 3 + rand(15))} ${n}`,
      dob.toISOString().slice(0, 10),
      n % 2 === 0 ? "male" : "female",
      pick(PLACES, n),
      pick(BLOOD, n * 5),
      n % 37 === 0 ? "Penicillin" : null,
      "active",
      createdBy,
    ]);
  }
  const cols = ["phone_normalized", "name", "dob", "gender", "address", "blood_group", "allergies", "status", "created_by"];
  const values = rows.map((_, r) => `(${cols.map((__, c) => `$${r * cols.length + c + 1}`).join(",")})`).join(",");
  const params = rows.flat();
  // No ON CONFLICT here: the live database currently has no unique
  // constraint/index on phone_normalized to arbitrate against (confirmed by
  // a failed dry run -- 42P10, "no unique or exclusion constraint matching").
  // Phone numbers are still deduplicated within this run via usedPhones.
  const { rowCount } = await pg.query(
    `insert into public.patients (${cols.join(",")}) values ${values}`,
    params,
  );
  inserted += rowCount;
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`  ${(batchStart + size).toLocaleString("en-IN")}/${TOTAL.toLocaleString("en-IN")} processed, ${inserted.toLocaleString("en-IN")} inserted (${elapsed}s)`);
}

await pg.end();
console.log(`\nDone. ${inserted.toLocaleString("en-IN")} patients inserted in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`);
