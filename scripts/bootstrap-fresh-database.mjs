/**
 * One-time bootstrap for a brand-new, schema-only database: everything
 * seed-demo-data.mjs assumes already exists: hospital identity, departments,
 * report categories, a starter charges master, and real login accounts for every active role plus a
 * handful of doctors across departments.
 *
 * Safe to re-run: every insert is keyed to a natural unique column and
 * upserts, so running this twice updates rather than duplicates.
 *
 *   node scripts/bootstrap-fresh-database.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
const db = createClient(url, key, { auth: { persistSession: false } });
const must = (label, { error }) => { if (error) throw new Error(`${label}: ${error.message}`); };

const STAFF_PASSWORD = process.env.DEMO_STAFF_PASSWORD || process.env.E2E_PASSWORD;
if (!STAFF_PASSWORD) throw new Error("Set DEMO_STAFF_PASSWORD or E2E_PASSWORD in .env for the seeded logins.");

console.log("1. Hospital identity...");
must("hospital_settings", await db.from("hospital_settings").upsert({
  id: true,
  hospital_name: "Pearl Aesthetic & Wellness Clinic",
  tagline: "Surgeon-led aesthetic & reconstructive care",
  address: "#755, K.P. Aspire, 1st Floor, 80ft Road, 4th Block, Koramangala, Bengaluru, Karnataka 560034",
  phone: "+91 79008 02060",
  email: "info@pearlaesthetic.in",
  prescription_footer: "Get well soon. This is a computer-generated prescription.",
  token_footer: "Please be seated; tokens are called in order.",
  digital_prescription_text: "Digitally generated prescription -- no signature required.",
}));

console.log("2. Departments...");
const DEPARTMENTS = [
  ["General Medicine", "Primary care, fevers, chronic disease follow-up"],
  ["Orthopedics", "Bones, joints, fractures, sprains"],
  ["Pediatrics", "Child health, 0-12 years"],
  ["Obstetrics & Gynaecology", "Women's health, antenatal care"],
  ["ENT", "Ear, nose and throat"],
];
must("departments", await db.from("departments").upsert(
  DEPARTMENTS.map(([name, description]) => ({ name, description, active: true })),
  { onConflict: "name" },
));
const { data: departments } = await db.from("departments").select("id,name");

console.log("3. Report categories...");
const REPORT_CATEGORIES = ["Blood Test", "X-Ray", "Ultrasound Scan", "ECG", "CT Scan", "MRI", "Urine Test", "Biopsy"];
must("report_categories", await db.from("report_categories").upsert(
  REPORT_CATEGORIES.map((name) => ({ name, active: true })),
  { onConflict: "name" },
));

console.log("4. Charges master...");
const CHARGES = [
  ["OP", "OP Consultation", 50000], ["Follow-up", "Follow-up Consultation", 30000],
  ["Procedure", "Dressing", 20000], ["Procedure", "Suturing", 60000],
  ["Procedure", "Aesthetic consultation", 50000],
];
must("charges", await db.from("charges").upsert(
  CHARGES.map(([category, charge_name, amount_paise]) => ({ category, charge_name, amount_paise, active: true })),
  { onConflict: "category,charge_name" },
));

console.log("5. Staff & doctor logins...");
const DOCTORS = [
  ["Dr Dharsan", "General Medicine", "General Physician", "MBBS, MD (General Medicine)"],
  ["Dr Meenakshi Sundaram", "Orthopedics", "Orthopedic Surgeon", "MBBS, MS (Ortho)"],
  ["Dr Kavitha Rajendran", "Pediatrics", "Pediatrician", "MBBS, MD (Pediatrics)"],
  ["Dr Lakshmi Priya", "Obstetrics & Gynaecology", "Gynaecologist", "MBBS, DGO"],
  ["Dr Senthil Kumar", "ENT", "ENT Surgeon", "MBBS, MS (ENT)"],
];
const STAFF = [
  ["admin", "Hospital Admin", "admin@meenakshihospital.com"],
  ["reception", "Reception Desk", "reception@meenakshihospital.com"],
  ["op", "OP Desk", "op@meenakshihospital.com"],
  ["pharmacy", "Pharmacy Counter", "pharmacy@meenakshihospital.com"],
  ["sales_executive", "Sales Executive", "sales@meenakshihospital.com"],
];

const { data: listed } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
const byEmail = new Map((listed?.users ?? []).map((u) => [u.email?.toLowerCase(), u]));

async function upsertUser(email, fullName, role) {
  let user = byEmail.get(email.toLowerCase());
  if (user) {
    const { data, error } = await db.auth.admin.updateUserById(user.id, { password: STAFF_PASSWORD, email_confirm: true, user_metadata: { full_name: fullName }, app_metadata: { role } });
    if (error) throw error;
    user = data.user;
  } else {
    const { data, error } = await db.auth.admin.createUser({ email, password: STAFF_PASSWORD, email_confirm: true, user_metadata: { full_name: fullName }, app_metadata: { role } });
    if (error || !data.user) throw error ?? new Error(`Could not create ${email}`);
    user = data.user;
  }
  must(`profile ${email}`, await db.from("profiles").upsert({ id: user.id, full_name: fullName, email, role, status: "active" }, { onConflict: "id" }));
  return user;
}

for (const [role, fullName, email] of STAFF) {
  await upsertUser(email, fullName, role);
  console.log(`  ${role.padEnd(10)} ${email}`);
}

const deptByName = new Map(departments.map((d) => [d.name, d.id]));
for (const [index, [displayName, deptName, specialization, qualification]] of DOCTORS.entries()) {
  const email = `${displayName.toLowerCase().replace(/^dr\.?\s*/, "").replace(/[^a-z]+/g, ".")}@meenakshihospital.com`;
  const user = await upsertUser(email, displayName, "doctor");
  const departmentId = deptByName.get(deptName);
  const { data: existing } = await db.from("doctors").select("id").eq("profile_id", user.id).maybeSingle();
  const doctorValues = {
    profile_id: user.id, display_name: displayName, department_id: departmentId,
    specialization, qualification, registration_number: `TN-${String(1000 + index).slice(-4)}`,
    op_fee_paise: 50000, follow_up_fee_paise: 30000, active: true,
  };
  let doctorId = existing?.id;
  if (doctorId) must("doctor update", await db.from("doctors").update(doctorValues).eq("id", doctorId));
  else {
    const { data, error } = await db.from("doctors").insert(doctorValues).select("id").single();
    if (error || !data) throw error ?? new Error("doctor insert failed");
    doctorId = data.id;
  }
  must("doctor link", await db.from("profiles").update({ doctor_id: doctorId }).eq("id", user.id));
  console.log(`  doctor     ${email} -> ${deptName}`);
}

console.log("\nBootstrap complete. Login with any address above and the shared password from .env (DEMO_STAFF_PASSWORD/E2E_PASSWORD).");
