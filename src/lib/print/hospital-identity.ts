export type HospitalIdentity = {
  name: string;
  tagline: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
};

/**
 * Used when settings have not been filled in yet, so a printed document never
 * comes out of the printer with a blank letterhead. Matches the hospital's
 * printed stationery.
 */
export const HOSPITAL_IDENTITY_FALLBACK: HospitalIdentity = {
  name: "Pearl Aesthetic & Wellness Clinic",
  tagline: "Surgeon-led aesthetic & reconstructive care",
  address: "#755, K.P. Aspire, 1st Floor, 80ft Road, 4th Block, Koramangala, Bengaluru, Karnataka 560034",
  phone: "+91 79008 02060",
  email: "info@pearlaesthetic.in",
};
