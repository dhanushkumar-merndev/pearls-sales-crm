/**
 * Categories for the Admin -> Charges master: the clinic's price list for
 * consultations, aesthetic procedures, treatments and tests. Kept as a fixed
 * list so the master stays consistent and reportable.
 */
export const CHARGE_MASTER_CATEGORIES = [
  "OP",
  "Follow-up",
  "Procedure",
  "Treatment",
  "Test",
  "Other",
] as const;
export type ChargeMasterCategory = (typeof CHARGE_MASTER_CATEGORIES)[number];
