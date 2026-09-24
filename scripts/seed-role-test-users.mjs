import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.DEMO_STAFF_PASSWORD ?? process.env.E2E_PASSWORD;
if (!url || !serviceKey || !password) throw new Error("Supabase URL, service key, and DEMO_STAFF_PASSWORD or E2E_PASSWORD are required.");

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const account = (role, fullName, fallbackEmail) => [
  role,
  role === "doctor" ? (process.env.E2E_DOCTOR_NAME ?? fullName) : fullName,
  process.env[`E2E_${role.toUpperCase()}_EMAIL`] ?? fallbackEmail,
];
const accounts = [
  account("admin", "Test Admin", "test.admin@meenakshihospital.com"),
  account("reception", "Test Reception", "test.reception@meenakshihospital.com"),
  account("op", "Test OP Staff", "test.op@meenakshihospital.com"),
  account("doctor", "Dr Test Doctor", "test.doctor@meenakshihospital.com"),
  account("pharmacy", "Test Pharmacy", "test.pharmacy@meenakshihospital.com"),
  account("sales_executive", "Test Sales Executive", "test.sales@meenakshihospital.com"),
].filter(([role]) => process.env.E2E_SKIP_ADMIN !== "1" || role !== "admin");

const { data: listed, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listError) throw listError;
const byEmail = new Map(listed.users.map((user) => [user.email?.toLowerCase(), user]));
const results = [];

for (const [role, fullName, email] of accounts) {
  let user = byEmail.get(email);
  let operation = "updated";
  if (user) {
    const { data, error } = await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true, user_metadata: { full_name: fullName }, app_metadata: { role } });
    if (error) throw error;
    user = data.user;
  } else {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName }, app_metadata: { role } });
    if (error || !data.user) throw error ?? new Error(`Could not create ${email}`);
    user = data.user;
    operation = "created";
  }

  const { error: profileError } = await admin.from("profiles").upsert({ id: user.id, full_name: fullName, email, role, status: "active" }, { onConflict: "id" });
  if (profileError) throw profileError;

  if (role === "doctor") {
    let { data: department, error: departmentError } = await admin.from("departments").select("id").eq("active", true).order("created_at").limit(1).maybeSingle();
    if (departmentError) throw departmentError;
    if (!department) {
      const { data, error } = await admin.from("departments").upsert(
        { name: "ZZ E2E Test Department", description: "Temporary department created by the E2E fixture script.", active: true },
        { onConflict: "name" },
      ).select("id").single();
      if (error || !data) throw error ?? new Error("Could not create the E2E test department.");
      department = data;
    }
    const { data: existingDoctor } = await admin.from("doctors").select("id").eq("profile_id", user.id).maybeSingle();
    let doctorId = existingDoctor?.id;
    if (doctorId) {
      const { error } = await admin.from("doctors").update({ display_name: fullName, department_id: department.id, specialization: "General Medicine", qualification: "MBBS", registration_number: "TEST-DOCTOR-001", op_fee_paise: 50000, follow_up_fee_paise: 30000, active: true }).eq("id", doctorId);
      if (error) throw error;
    } else {
      const { data, error } = await admin.from("doctors").insert({ profile_id: user.id, display_name: fullName, department_id: department.id, specialization: "General Medicine", qualification: "MBBS", registration_number: "TEST-DOCTOR-001", op_fee_paise: 50000, follow_up_fee_paise: 30000, active: true }).select("id").single();
      if (error || !data) throw error ?? new Error("Doctor record could not be created.");
      doctorId = data.id;
    }
    const { error: linkError } = await admin.from("profiles").update({ doctor_id: doctorId }).eq("id", user.id);
    if (linkError) throw linkError;
  }
  results.push({ role, email, operation });
}

// The multi-consultant reception workflow needs a second selectable clinician.
// Keep it visibly test-only so it can be removed safely by the E2E teardown.
const secondDoctorEmail = process.env.E2E_SECOND_DOCTOR_EMAIL ?? "qa.doctor.second@example.invalid";
const secondDoctorName = "Dr E2E Second Consultant";
let secondDoctorUser = byEmail.get(secondDoctorEmail);
let secondDoctorOperation = "updated";
if (secondDoctorUser) {
  const { data, error } = await admin.auth.admin.updateUserById(secondDoctorUser.id, {
    password,
    email_confirm: true,
    user_metadata: { full_name: secondDoctorName },
    app_metadata: { role: "doctor" },
  });
  if (error) throw error;
  secondDoctorUser = data.user;
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email: secondDoctorEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: secondDoctorName },
    app_metadata: { role: "doctor" },
  });
  if (error || !data.user) throw error ?? new Error(`Could not create ${secondDoctorEmail}`);
  secondDoctorUser = data.user;
  secondDoctorOperation = "created";
}
const { error: secondProfileError } = await admin.from("profiles").upsert({
  id: secondDoctorUser.id,
  full_name: secondDoctorName,
  email: secondDoctorEmail,
  role: "doctor",
  status: "active",
}, { onConflict: "id" });
if (secondProfileError) throw secondProfileError;
const { data: secondDepartment, error: secondDepartmentError } = await admin
  .from("departments")
  .select("id")
  .eq("active", true)
  .order("created_at")
  .limit(1)
  .single();
if (secondDepartmentError || !secondDepartment) throw secondDepartmentError ?? new Error("E2E test department is missing.");
const { data: existingSecondDoctor, error: existingSecondDoctorError } = await admin
  .from("doctors")
  .select("id")
  .eq("profile_id", secondDoctorUser.id)
  .maybeSingle();
if (existingSecondDoctorError) throw existingSecondDoctorError;
let secondDoctorId = existingSecondDoctor?.id;
if (secondDoctorId) {
  const { error } = await admin.from("doctors").update({
    display_name: secondDoctorName,
    department_id: secondDepartment.id,
    specialization: "General Medicine",
    qualification: "MBBS",
    registration_number: "TEST-DOCTOR-002",
    op_fee_paise: 50000,
    follow_up_fee_paise: 30000,
    active: true,
  }).eq("id", secondDoctorId);
  if (error) throw error;
} else {
  const { data, error } = await admin.from("doctors").insert({
    profile_id: secondDoctorUser.id,
    display_name: secondDoctorName,
    department_id: secondDepartment.id,
    specialization: "General Medicine",
    qualification: "MBBS",
    registration_number: "TEST-DOCTOR-002",
    op_fee_paise: 50000,
    follow_up_fee_paise: 30000,
    active: true,
  }).select("id").single();
  if (error || !data) throw error ?? new Error("Could not create the second E2E doctor.");
  secondDoctorId = data.id;
}
const { error: secondLinkError } = await admin.from("profiles").update({ doctor_id: secondDoctorId }).eq("id", secondDoctorUser.id);
if (secondLinkError) throw secondLinkError;
results.push({ role: "doctor (second consultant)", email: secondDoctorEmail, operation: secondDoctorOperation });

const { error: reportCategoryError } = await admin.from("report_categories").upsert(
  { name: "ZZ E2E Lab Report", active: true },
  { onConflict: "name" },
);
if (reportCategoryError) throw reportCategoryError;

console.log(JSON.stringify(results, null, 2));
