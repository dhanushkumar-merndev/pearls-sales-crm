import { z } from "zod";
import { normalizeIndianPhone } from "@/lib/domain/phone";

/**
 * Patient demographics as they arrive from a form. Shared so that registering a
 * patient on its own and registering one together with their first visit accept
 * and store exactly the same fields.
 */
export const patientSchema = z.object({
  name: z.string().trim().min(2, "Name must contain at least 2 characters.").max(120),
  // Blank UHID is allowed: the database trigger issues the next MH-###### code.
  uhid: z.string().trim().max(30).optional(),
  phone: z.string().trim(),
  dob: z.string().optional(),
  age: z.string().trim().optional(),
  gender: z.enum(["male", "female", "other", "unknown"]),
  bloodGroup: z.string().trim().max(10).optional(),
  address: z.string().trim().max(500).optional(),
  allergies: z.string().trim().max(1000).optional(),
  referenceDetail: z.string().trim().max(200).optional(),
});

export type PatientInput = z.infer<typeof patientSchema>;

/**
 * Patients often know their age but not their birth date. An age is converted to
 * a dob of 1 January that year and flagged approximate, so age still displays
 * correctly without inventing a precise birthday.
 */
export function resolveDob(dob?: string, age?: string) {
  if (dob) return { dob, approximate: false };
  const years = age ? Number(age) : Number.NaN;
  if (!Number.isFinite(years) || years < 0 || years > 120) return { dob: null, approximate: false };
  return { dob: `${new Date().getFullYear() - Math.floor(years)}-01-01`, approximate: true };
}

/** Form values as a patients row, or the phone error that stopped it. */
export function buildPatientRow(input: PatientInput) {
  let phone: string;
  try {
    phone = normalizeIndianPhone(input.phone);
  } catch (error) {
    return { phoneError: (error as Error).message, row: null };
  }
  const { dob, approximate } = resolveDob(input.dob, input.age);
  return {
    phoneError: null,
    row: {
      name: input.name,
      // Omitted rather than sent as undefined, so the database trigger issues
      // the next MH-###### code.
      ...(input.uhid ? { uhid: input.uhid.toUpperCase() } : {}),
      phone_normalized: phone,
      dob,
      dob_is_approximate: approximate,
      gender: input.gender,
      blood_group: input.bloodGroup || null,
      address: input.address || null,
      allergies: input.allergies || null,
      reference_detail: input.referenceDetail || null,
    },
  };
}
