import * as XLSX from "xlsx";
import { getCurrentProfile } from "@/lib/auth/dal";
import { PATIENT_IMPORT_HEADERS } from "@/features/patients/import-schema";
import { formatRowLimit } from "@/lib/domain/bulk-import";

export async function GET() {
  const profile = await getCurrentProfile();
  if (!["admin", "reception"].includes(profile.role)) return new Response("Forbidden", { status: 403 });

  const example = {
    name: "Rajesh Kumar",
    phone: "9876543210",
    gender: "male",
    dob: "1994-03-18",
    blood_group: "O+",
    address: "12 Bazaar Street, Ramanathapuram",
    allergies: "Penicillin",
    notes: "Transferred from the old register",
  };
  const patients = XLSX.utils.json_to_sheet([example], { header: [...PATIENT_IMPORT_HEADERS] });
  const instructions = XLSX.utils.aoa_to_sheet([
    ["Pearl Aesthetic Patient Import"],
    ["Required columns", "name, phone"],
    ["phone", "10-digit Indian mobile number. Several patients may share one; the Patient ID is the UHID."],
    ["gender", "male, female, other or unknown (blank means unknown)"],
    ["dob", "YYYY-MM-DD, or leave blank if not known"],
    ["blood_group", "A+, A-, B+, B-, AB+, AB-, O+ or O-"],
    ["limit", `Maximum ${formatRowLimit()} data rows per import`],
    ["existing patients", "A phone already in the system is skipped, never overwritten"],
  ]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, patients, "Patients");
  XLSX.utils.book_append_sheet(workbook, instructions, "Instructions");
  const output = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  return new Response(new Uint8Array(output), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=pearl-patient-import-template.xlsx",
      "Cache-Control": "private, no-store",
    },
  });
}
