import { normalizeIndianPhone } from "@/lib/domain/phone";
import {
  cellText,
  formatRowLimit,
  isIsoDate,
  MAX_IMPORT_ROWS,
  type ImportErrorRow,
} from "@/lib/domain/bulk-import";

export const PATIENT_IMPORT_HEADERS = [
  "name",
  "phone",
  "gender",
  "dob",
  "blood_group",
  "address",
  "allergies",
  "notes",
] as const;

export type NormalizedPatientImport = {
  name: string;
  phone_normalized: string;
  gender: "male" | "female" | "other" | "unknown";
  dob: string | null;
  blood_group: string | null;
  address: string | null;
  allergies: string | null;
  notes: string | null;
};

const GENDERS = ["male", "female", "other", "unknown"] as const;
const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

/**
 * Validates a patient register exported from the hospital's old system.
 *
 * Phone is the visible Patient ID and is unique, so a repeat inside one file is
 * an error rather than a silent overwrite -- two different people would end up
 * sharing one record. A phone that already exists in the database is handled by
 * the import RPC, which skips it and reports it, so re-uploading the same file
 * is safe.
 */
export function validatePatientImportRows(input: unknown[]): {
  valid: NormalizedPatientImport[];
  invalid: ImportErrorRow[];
} {
  const valid: NormalizedPatientImport[] = [];
  const invalid: ImportErrorRow[] = [];
  const phones = new Set<string>();

  input.slice(0, MAX_IMPORT_ROWS).forEach((source, index) => {
    const data = (source && typeof source === "object" ? source : {}) as Record<string, unknown>;
    const errors: string[] = [];

    const name = cellText(data.name);
    if (name.length < 2) errors.push("name is required");

    let phone_normalized = "";
    try {
      phone_normalized = normalizeIndianPhone(cellText(data.phone));
    } catch {
      errors.push("phone must be a 10-digit Indian mobile number");
    }
    if (phone_normalized && phones.has(phone_normalized)) {
      errors.push("this phone appears more than once in the file");
    }
    if (phone_normalized) phones.add(phone_normalized);

    const genderText = cellText(data.gender).toLowerCase();
    const gender = (genderText === "" ? "unknown" : genderText) as NormalizedPatientImport["gender"];
    if (!GENDERS.includes(gender)) errors.push(`gender must be one of ${GENDERS.join(", ")}`);

    const dobText = cellText(data.dob);
    let dob: string | null = null;
    if (dobText !== "") {
      if (!isIsoDate(dobText)) errors.push("dob must be YYYY-MM-DD");
      else if (dobText > new Date().toISOString().slice(0, 10)) errors.push("dob cannot be in the future");
      else dob = dobText;
    }

    const bloodText = cellText(data.blood_group).toUpperCase();
    if (bloodText !== "" && !BLOOD_GROUPS.includes(bloodText)) {
      errors.push(`blood_group must be one of ${BLOOD_GROUPS.join(", ")}`);
    }

    if (errors.length) {
      invalid.push({ row: index + 2, data, errors });
      return;
    }

    valid.push({
      name,
      phone_normalized,
      gender,
      dob,
      blood_group: bloodText || null,
      address: cellText(data.address) || null,
      allergies: cellText(data.allergies) || null,
      notes: cellText(data.notes) || null,
    });
  });

  if (input.length > MAX_IMPORT_ROWS) {
    invalid.push({
      row: MAX_IMPORT_ROWS + 2,
      data: {},
      errors: [`Maximum ${formatRowLimit()} data rows per upload`],
    });
  }
  return { valid, invalid };
}
