/**
 * Development seed for Pearl Clinic.
 *
 * Wipes all patient/transactional data and regenerates a realistic dataset.
 * Staff profiles, doctors and departments are preserved — they are tied to auth
 * accounts you log in with.
 *
 * Never run this against a production database. Requires SUPABASE_SERVICE_ROLE_KEY.
 *   node scripts/seed-demo-data.mjs [patientCount] --project <ref> --yes
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
const args = process.argv.slice(2);
const projectIndex = args.indexOf("--project");
const confirmedRef = projectIndex >= 0 ? args[projectIndex + 1] : undefined;
if (!args.includes("--yes") || !confirmedRef || confirmedRef !== process.env.SUPABASE_PROJECT_ID || new URL(url).hostname !== `${confirmedRef}.supabase.co`) {
  throw new Error("This seed replaces clinic records. Pass --project <matching project ref> --yes only for a disposable development database.");
}
const db = createClient(url, key, { auth: { persistSession: false } });

const PATIENT_COUNT = Number(process.argv[2]) || 100;
const must = (label, { error }) => { if (error) throw new Error(`${label}: ${error.message}`); };
const pick = (arr, i) => arr[i % arr.length];
const rand = (n) => Math.floor(Math.random() * n);
const IST = "Asia/Kolkata";
const dayKey = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(d);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
// pg returns DATE columns as JS Date objects; normalise before comparing to dayKey().
const vDate = (v) => (v.visit_date instanceof Date ? dayKey(v.visit_date) : String(v.visit_date));

// ---------------------------------------------------------------- wipe
// TRUNCATE rather than DELETE: completed consultations and prescriptions are
// protected by immutability triggers (correctly — they are medical records),
// and TRUNCATE does not fire row-level triggers. CASCADE handles FK order.
//
// Staff, doctors, departments and hospital settings are preserved:
// they are tied to the auth accounts you log in with.
const WIPE = [
  "procedure_sale_items", "procedure_sales",
  "pharmacy_sale_items", "pharmacy_sales", "stock_movements",
  "prescription_items", "prescriptions",
  "test_orders", "patient_reports", "vitals", "consultations",
  "visit_payments",
  "visits", "patients",
  "lead_activities", "leads",
  "daily_token_sequences",
  "medicine_batches", "medicine_directory", "inventory_items", "clinical_terms",
];
console.log("Wiping transactional data...");
const { Client } = await import("pg");
const pw = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD ?? "");
const ref = process.env.SUPABASE_PROJECT_ID;
if (!pw || !ref) throw new Error("SUPABASE_DB_PASSWORD and SUPABASE_PROJECT_ID are required.");
const pg = new Client({
  connectionString: `postgresql://postgres.${ref}:${pw}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await pg.connect();
await pg.query(`truncate table ${WIPE.map((t) => `public.${t}`).join(", ")} restart identity cascade`);
console.log(`  ${WIPE.length} tables truncated`);

// Historical rows are protected by immutability triggers ("closed visit vitals
// are immutable", "completed consultation is immutable"). Those guards are
// correct for the running app but make backdated seed data impossible to write,
// so they are suspended for this session only.
await pg.query("set session_replication_role = replica");

/** Multi-row insert that respects column defaults and returns the new rows. */
async function bulkInsert(table, rows, returning = "*") {
  if (!rows.length) return [];
  const out = [];
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const perChunk = Math.max(1, Math.floor(60000 / cols.length));
  for (let i = 0; i < rows.length; i += perChunk) {
    const chunk = rows.slice(i, i + perChunk);
    const values = chunk
      .map((_, r) => `(${cols.map((__, c) => `$${r * cols.length + c + 1}`).join(",")})`)
      .join(",");
    const params = chunk.flatMap((row) => cols.map((c) => row[c] ?? null));
    const { rows: inserted } = await pg.query(
      `insert into public.${table} (${cols.join(",")}) values ${values} returning ${returning}`,
      params,
    );
    out.push(...inserted);
  }
  return out;
}

// ---------------------------------------------------------------- staff
const { data: profiles } = await db.from("profiles").select("id,full_name,role,doctor_id");
const byRole = (r) => profiles.filter((p) => p.role === r);
const admin = byRole("admin")[0];
const reception = byRole("reception")[0] ?? admin;
const opStaff = byRole("op")[0] ?? admin;
if (!admin) throw new Error("No admin profile found — create staff accounts first.");

const { data: doctors } = await db.from("doctors").select("id,display_name,department_id,op_fee_paise,follow_up_fee_paise").eq("active", true);
if (!doctors?.length) throw new Error("No active doctors found.");
console.log(`\nUsing ${doctors.length} doctors, admin=${admin.full_name}`);

// ---------------------------------------------------------------- masters
console.log("\nSeeding masters...");
const MEDICINES = [
  ["Dolo 650", "Paracetamol", "650 mg", "Tablet", "Micro Labs"],
  ["Crocin 500", "Paracetamol", "500 mg", "Tablet", "GSK"],
  ["Calpol Syrup", "Paracetamol", "250 mg/5 ml", "Syrup", "GSK"],
  ["Augmentin 625", "Amoxicillin + Clavulanic Acid", "625 mg", "Tablet", "GSK"],
  ["Mox 500", "Amoxicillin", "500 mg", "Capsule", "Ranbaxy"],
  ["ZIFI 200", "Cefixime", "200 mg", "Tablet", "FDC"],
  ["Taxim-O 200", "Cefixime", "200 mg", "Tablet", "Alkem"],
  ["Azithral 500", "Azithromycin", "500 mg", "Tablet", "Alembic"],
  ["Pan 40", "Pantoprazole", "40 mg", "Tablet", "Alkem"],
  ["Omez 20", "Omeprazole", "20 mg", "Capsule", "Dr Reddy's"],
  ["Rantac 150", "Ranitidine", "150 mg", "Tablet", "JB Chemicals"],
  ["Allegra 120", "Fexofenadine", "120 mg", "Tablet", "Sanofi"],
  ["Cetzine 10", "Cetirizine", "10 mg", "Tablet", "GSK"],
  ["Avil 25", "Pheniramine Maleate", "25 mg", "Tablet", "Sanofi"],
  ["Combiflam", "Ibuprofen + Paracetamol", "400/325 mg", "Tablet", "Sanofi"],
  ["Voveran SR 100", "Diclofenac", "100 mg", "Tablet", "Novartis"],
  ["Metformin 500", "Metformin", "500 mg", "Tablet", "USV"],
  ["Glycomet GP1", "Metformin + Glimepiride", "500/1 mg", "Tablet", "USV"],
  ["Telma 40", "Telmisartan", "40 mg", "Tablet", "Glenmark"],
  ["Amlong 5", "Amlodipine", "5 mg", "Tablet", "Micro Labs"],
  ["Atorva 10", "Atorvastatin", "10 mg", "Tablet", "Zydus"],
  ["Shelcal 500", "Calcium + Vitamin D3", "500 mg", "Tablet", "Torrent"],
  ["Zincovit", "Multivitamin + Zinc", "-", "Tablet", "Apex"],
  ["Asthalin Inhaler", "Salbutamol", "100 mcg", "Inhaler", "Cipla"],
  ["Betadine Ointment", "Povidone Iodine", "5%", "Ointment", "Win-Medicare"],
  ["Soframycin Cream", "Framycetin", "1%", "Cream", "Sanofi"],
  ["Monocef 1gm", "Ceftriaxone", "1 g", "Injection", "Aristo"],
  ["Emeset 4mg", "Ondansetron", "4 mg", "Injection", "Cipla"],
];
const medRows = MEDICINES.map(([brand_name, generic_name, strength, dosage_form, manufacturer]) => ({
  brand_name, generic_name, strength, dosage_form, manufacturer, active: true, source: "development sample",
}));
must("medicines", await db.from("medicine_directory").insert(medRows));
const { data: meds } = await db.from("medicine_directory").select("id,brand_name,dosage_form");
console.log(`  ${meds.length} medicines`);

// One or two batches each, some deliberately low or near expiry so the alerts show.
const batchRows = [];
meds.forEach((m, i) => {
  const batches = i % 4 === 0 ? 2 : 1;
  for (let b = 0; b < batches; b++) {
    const low = i % 7 === 0;
    const nearExpiry = i % 9 === 0;
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + (nearExpiry ? 1 : 12 + rand(18)));
    const price = 1000 + rand(9000);
    batchRows.push({
      medicine_id: m.id,
      batch_number: `${m.brand_name.split(" ")[0].toUpperCase().slice(0, 6)}-${2026}${String(b + 1).padStart(2, "0")}`,
      expiry_date: expiry.toISOString().slice(0, 10),
      quantity: low ? 3 + rand(5) : 60 + rand(200),
      purchase_price_paise: Math.round(price * 0.7),
      selling_price_paise: price,
      low_stock_threshold: 20,
      active: true,
    });
  }
});
must("batches", await db.from("medicine_batches").insert(batchRows));
console.log(`  ${batchRows.length} medicine batches`);

const INVENTORY = [
  ["Sterile Gauze Pad 4x4", "piece", 1200, 240], ["Cotton Roll 500g", "roll", 9000, 40],
  ["Crepe Bandage 10cm", "roll", 6500, 60], ["Adhesive Bandage Roll", "roll", 4500, 80],
  ["Silk Suture 2-0", "packet", 18000, 25], ["Catgut Suture 3-0", "packet", 21000, 18],
  ["Disposable Syringe 5ml", "piece", 800, 400], ["IV Cannula 20G", "piece", 3500, 120],
  ["Surgical Gloves (pair)", "pair", 1500, 300], ["Povidone Iodine Solution 100ml", "bottle", 8500, 35],
  ["Micropore Tape", "roll", 3000, 70], ["Dressing Tray Kit", "kit", 25000, 15],
];
const invRows = INVENTORY.map(([name, unit, selling_price_paise, quantity], i) => {
  const expiry = new Date(); expiry.setMonth(expiry.getMonth() + 12 + rand(24));
  return { name, unit, selling_price_paise, quantity, low_stock_threshold: i % 5 === 0 ? 50 : 20, expiry_date: expiry.toISOString().slice(0, 10), active: true };
});
must("inventory", await db.from("inventory_items").insert(invRows));
console.log(`  ${invRows.length} inventory items`);

const TERMS = [
  ["symptom", "Fever", ["pyrexia", "temperature"]], ["symptom", "Cough", ["kaas"]],
  ["symptom", "Cold and runny nose", ["coryza"]], ["symptom", "Headache", ["cephalgia"]],
  ["symptom", "Body pain", ["myalgia"]], ["symptom", "Vomiting", ["emesis"]],
  ["symptom", "Loose stools", ["diarrhoea"]], ["symptom", "Breathlessness", ["dyspnoea"]],
  ["symptom", "Chest pain", []], ["symptom", "Giddiness", ["vertigo"]],
  ["diagnosis", "Viral fever", ["viral illness"]], ["diagnosis", "Upper respiratory tract infection", ["URTI"]],
  ["diagnosis", "Acute gastritis", []], ["diagnosis", "Type 2 diabetes mellitus", ["T2DM"]],
  ["diagnosis", "Hypertension", ["HTN"]], ["diagnosis", "Acute bronchitis", []],
  ["diagnosis", "Urinary tract infection", ["UTI"]], ["diagnosis", "Anaemia", []],
  ["diagnosis", "Bronchial asthma", ["asthma"]], ["diagnosis", "Lumbar sprain", ["low back pain"]],
  ["investigation", "Complete Blood Count", ["CBC", "hemogram"]], ["investigation", "Random Blood Sugar", ["RBS"]],
  ["investigation", "Fasting Blood Sugar", ["FBS"]], ["investigation", "HbA1c", []],
  ["investigation", "Urine Routine", ["urine albumin"]], ["investigation", "Chest X-Ray PA View", ["CXR"]],
  ["investigation", "ECG", ["electrocardiogram"]], ["investigation", "Serum Creatinine", []],
  ["investigation", "Liver Function Test", ["LFT"]], ["investigation", "Thyroid Profile", ["TSH"]],
  ["advice", "Drink adequate fluids", ["hydration"]], ["advice", "Take complete bed rest", []],
  ["advice", "Review after 3 days", []], ["advice", "Avoid oily and spicy food", []],
  ["advice", "Monitor blood sugar daily", []],
];
must("terms", await db.from("clinical_terms").insert(
  TERMS.map(([term_type, display_text, search_aliases]) => ({ term_type, display_text, search_aliases, active: true, source: "development sample" })),
));
console.log(`  ${TERMS.length} clinical terms`);

// ---------------------------------------------------------------- patients
const FIRST = ["Rajesh", "Priya", "Karthik", "Lakshmi", "Suresh", "Meena", "Arun", "Divya", "Ganesh", "Kavitha", "Murugan", "Anitha", "Vijay", "Revathi", "Saravanan", "Deepa", "Ramesh", "Sangeetha", "Bala", "Nithya", "Prakash", "Uma", "Selvam", "Geetha", "Manoj", "Shalini", "Ravi", "Poornima", "Dinesh", "Bhavani"];
const LAST = ["Kumar", "Raman", "Krishnan", "Subramani", "Natarajan", "Pillai", "Iyer", "Nair", "Reddy", "Chandran", "Murthy", "Venkatesh", "Sekar", "Rajan", "Mohan"];
const BLOOD = ["A+", "B+", "O+", "AB+", "A-", "O-", null];
const PLACES = ["Ramanathapuram", "Paramakudi", "Mudukulathur", "Kamuthi", "Uchipuli", "Thondi", "Sayalkudi", "Kadaladi"];

console.log(`\nSeeding ${PATIENT_COUNT} patients...`);
const patientRows = [];
const usedPhones = new Set();
for (let i = 0; i < PATIENT_COUNT; i++) {
  // Some families deliberately share a phone number (rural reality).
  let phone;
  if (i > 0 && i % 12 === 0) phone = patientRows[i - 1].phone_normalized;
  else { do { phone = `9${String(100000000 + rand(899999999))}`.slice(0, 10); } while (usedPhones.has(phone)); }
  usedPhones.add(phone);
  const dob = new Date(); dob.setFullYear(dob.getFullYear() - (1 + rand(80))); dob.setMonth(rand(12)); dob.setDate(1 + rand(28));
  patientRows.push({
    phone_normalized: phone,
    name: `${pick(FIRST, i * 7 + rand(30))} ${pick(LAST, i * 3 + rand(15))}`,
    dob: dob.toISOString().slice(0, 10),
    gender: i % 2 === 0 ? "male" : "female",
    address: pick(PLACES, i),
    blood_group: pick(BLOOD, i * 5),
    allergies: i % 11 === 0 ? "Penicillin" : null,
    status: "active",
    created_by: reception.id,
  });
}
// Shared phones break a plain upsert, so insert in chunks and tolerate collisions.
const patients = [];
for (let i = 0; i < patientRows.length; i += 25) {
  const chunk = patientRows.slice(i, i + 25);
  const { data, error } = await db.from("patients").insert(chunk).select("id,name,phone_normalized");
  if (error) {
    for (const row of chunk) {
      const one = await db.from("patients").insert(row).select("id,name,phone_normalized").single();
      if (!one.error) patients.push(one.data);
    }
    continue;
  }
  patients.push(...data);
}
console.log(`  ${patients.length} patients created`);

// ---------------------------------------------------------------- visits
console.log("\nSeeding visits, consultations and prescriptions...");
const tokenSeries = new Map(); // `${date}|${doctorId}` -> last token
const nextToken = (date, doctorId) => {
  const k = `${date}|${doctorId}`;
  const n = (tokenSeries.get(k) ?? 0) + 1;
  tokenSeries.set(k, n);
  return n;
};
const SYMPTOMS = ["Fever since 3 days", "Cough and cold", "Headache and body pain", "Loose stools since morning", "Breathlessness on exertion", "Burning micturition"];
const DIAGNOSES = ["Viral fever", "Upper respiratory tract infection", "Acute gastritis", "Urinary tract infection", "Bronchial asthma", "Type 2 diabetes mellitus"];
const FREQ = ["OD (1-0-0)", "BD (1-0-1)", "TDS (1-1-1)", "HS (0-0-1)"];
const DURATION = ["3 days", "5 days", "7 days", "10 days"];
const NOTES = ["After food", "Before food", "At bedtime"];

const visitRows = [];
for (let d = 13; d >= 0; d--) {
  const date = dayKey(daysAgo(d));
  const perDay = d === 0 ? 14 : 12 + rand(10);
  for (let v = 0; v < perDay; v++) {
    const patient = patients[rand(patients.length)];
    const doctor = doctors[rand(doctors.length)];
    const isToday = d === 0;
    // Today's queue keeps a spread of live statuses; past days are all closed.
    const status = isToday ? pick(["waiting", "vitals_pending", "ready", "in_consultation", "completed", "completed"], v) : "completed";
    visitRows.push({
      patient_id: patient.id,
      doctor_id: doctor.id,
      department_id: doctor.department_id,
      // Follow-ups need a linked previous visit (visits_check), so they are
      // added in a second pass below once real prior visits exist.
      visit_type: "op",
      visit_date: date,
      token_number: nextToken(date, doctor.id),
      // The doctor sets the fee at completion; unbilled visits stay at 0.
      fee_paise: status === "completed" ? doctor.op_fee_paise : 0,
      status,
      idempotency_key: crypto.randomUUID(),
      created_by: reception.id,
      created_at: new Date(daysAgo(d).setHours(9 + rand(9), rand(60))).toISOString(),
    });
  }
}
const visits = await bulkInsert("visits", visitRows, "id,patient_id,doctor_id,status,visit_type,fee_paise,visit_date,created_at");
// Second pass: follow-ups linked to a real earlier visit of the same patient.
{
  const doctorById = new Map(doctors.map((d) => [d.id, d]));
  const earlier = visits.filter((v) => v.status === "completed" && vDate(v) < dayKey(new Date()));
  const followRows = [];
  for (let i = 0; i < 18 && i < earlier.length; i++) {
    const prev = earlier[i * 3 % earlier.length];
    const doctor = doctorById.get(prev.doctor_id);
    const date = dayKey(daysAgo(rand(3)));
    followRows.push({
      patient_id: prev.patient_id, doctor_id: prev.doctor_id, department_id: doctor.department_id,
      visit_type: "follow_up", visit_date: date, token_number: nextToken(date, prev.doctor_id),
      fee_paise: doctor.follow_up_fee_paise, status: "completed",
      related_previous_visit_id: prev.id,
      idempotency_key: crypto.randomUUID(), created_by: reception.id,
    });
  }
  const data = await bulkInsert("visits", followRows, "id,patient_id,doctor_id,status,visit_type,fee_paise,visit_date,created_at");
  visits.push(...data); console.log(`  ${data.length} follow-up visits linked`);
}
console.log(`  ${visits.length} visits`);

// Seed the per-doctor sequence table so new tokens continue, never collide.
const seqRows = [...tokenSeries.entries()].map(([k, last_token]) => {
  const [token_date, doctor_id] = k.split("|");
  return { token_date, doctor_id, last_token };
});
await bulkInsert("daily_token_sequences", seqRows, "token_date");

const done = visits.filter((v) => v.status === "completed");
const withVitals = visits.filter((v) => v.status !== "waiting");
await bulkInsert("vitals", withVitals.map((v) => ({
  visit_id: v.id, weight_kg: 45 + rand(45), height_cm: 145 + rand(40),
  temperature_f: [98.2, 99.0, 101.1, 102.4][rand(4)], bp_systolic: 105 + rand(45), bp_diastolic: 65 + rand(25),
  pulse: 62 + rand(40), spo2: 95 + rand(5), respiratory_rate: 14 + rand(6), recorded_by: opStaff.id,
})), "id");
console.log(`  ${withVitals.length} vitals`);

await bulkInsert("consultations", done.map((v, i) => ({
  visit_id: v.id, doctor_id: v.doctor_id,
  symptoms: pick(SYMPTOMS, i), history: i % 3 === 0 ? "No known comorbidities." : null,
  examination: "Afebrile, chest clear, no added sounds.", assessment: pick(DIAGNOSES, i),
  advice: i % 2 === 0 ? "Drink adequate fluids and take rest." : null,
  follow_up_type: i % 5 === 0 ? "after_days" : "none", follow_up_days: i % 5 === 0 ? 5 : null,
  status: "completed", completed_at: v.created_at,
})), "id");
console.log(`  ${done.length} consultations`);

// Prescriptions: most dispensed already, a handful left pending for the queue.
const rxRows = done.map((v, i) => ({
  visit_id: v.id, doctor_id: v.doctor_id,
  status: i % 7 === 0 ? "pending" : "dispensed",
  created_at: v.created_at,
}));
const prescriptions = await bulkInsert("prescriptions", rxRows, "id,visit_id,status");
const itemRows = [];
prescriptions.forEach((rx, i) => {
  for (let n = 0; n < 1 + rand(3); n++) {
    const med = meds[rand(meds.length)];
    const qty = 5 + rand(15);
    itemRows.push({
      prescription_id: rx.id, medicine_id: med.id, medicine_name: med.brand_name,
      dose: med.dosage_form === "Syrup" ? "5 ml" : "1 tablet",
      frequency: pick(FREQ, i + n), duration: pick(DURATION, i + n), route: "Oral", notes: pick(NOTES, i + n),
      requested_quantity: qty, dispensed_quantity: rx.status === "dispensed" ? qty : 0,
    });
  }
});
await bulkInsert("prescription_items", itemRows, "id");
console.log(`  ${prescriptions.length} prescriptions, ${itemRows.length} items`);

// Payments: most completed visits paid, some deliberately left outstanding so
// the new "Pending Consultation Fees" screen has rows.
const payRows = done.filter((v, i) => v.fee_paise > 0 && i % 6 !== 0).map((v) => ({
  visit_id: v.id, amount_paise: v.fee_paise, mode: pick(["cash", "upi", "card"], rand(3)),
  idempotency_key: crypto.randomUUID(), collected_by: reception.id, created_at: v.created_at,
}));
await bulkInsert("visit_payments", payRows, "id");
console.log(`  ${payRows.length} visit payments (${done.filter((v, i) => v.fee_paise > 0 && i % 6 === 0).length} left unpaid on purpose)`);

console.log("\nSeed complete.");
console.log(`  patients: ${patients.length}`);
console.log(`  visits:   ${visits.length} (today: ${visits.filter((v) => vDate(v) === dayKey(new Date())).length})`);
console.log(`  pending pharmacy prescriptions: ${prescriptions.filter((r) => r.status === "pending").length}`);

await pg.query("set session_replication_role = origin");
await pg.end();
