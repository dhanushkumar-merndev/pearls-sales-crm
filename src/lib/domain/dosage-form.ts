/**
 * A prescription row is the same five fields for every medicine, but the units
 * are not: a syrup is dosed in ml, an injection in ml or units, an inhaler in
 * puffs, an ointment not in countable pieces at all. The dose box used to
 * prompt "1 tablet" for all of them, which reads as an instruction when the
 * medicine on the row is Calpol Syrup.
 *
 * The medicine directory's dosage_form drives the prompt, the quantity unit
 * and the default route. Matching is on lowercased substrings because the
 * directory is free text from imported supplier lists ("Tablet", "TAB",
 * "Injection (vial)") rather than a constrained enum.
 */
export type DosageFormHints = {
  /** Placeholder for the dose box, in the medicine's own unit. */
  dosePlaceholder: string;
  /** Plural unit for the dispensed quantity ("tablets", "ml", "puffs"). */
  quantityUnit: string;
  /** Route to default the row to, or null to leave whatever is set. */
  route: string | null;
};

const UNKNOWN: DosageFormHints = {
  dosePlaceholder: "Dose",
  quantityUnit: "units",
  route: null,
};

// Ordered: the first matching keyword wins, so the narrower forms ("eye drop",
// "dry syrup") are listed before the broader ones they contain.
const RULES: Array<{ match: string[]; hints: DosageFormHints }> = [
  {
    match: ["drop"],
    hints: { dosePlaceholder: "2 drops", quantityUnit: "ml", route: "Topical" },
  },
  {
    match: ["inhaler", "rotacap", "respule", "nebul", "puff", "mdi"],
    hints: { dosePlaceholder: "2 puffs", quantityUnit: "doses", route: "Inhalation" },
  },
  {
    match: ["injection", "inj", "vial", "ampoule", "amp", "infusion"],
    hints: { dosePlaceholder: "1 ml", quantityUnit: "ml", route: "IV" },
  },
  {
    match: ["syrup", "suspension", "solution", "elixir", "liquid", "oral liquid"],
    hints: { dosePlaceholder: "5 ml", quantityUnit: "ml", route: "Oral" },
  },
  {
    match: ["ointment", "cream", "gel", "lotion", "paste", "spray", "patch"],
    // Not countable per dose: quantity stays whatever the doctor types, and
    // the auto-quantity refuses a non-numeric dose on its own.
    hints: { dosePlaceholder: "Apply locally", quantityUnit: "tubes", route: "Topical" },
  },
  {
    match: ["sachet", "powder", "granule"],
    hints: { dosePlaceholder: "1 sachet", quantityUnit: "sachets", route: "Oral" },
  },
  {
    match: ["suppository"],
    hints: { dosePlaceholder: "1 suppository", quantityUnit: "pieces", route: "PR" },
  },
  {
    match: ["capsule", "cap"],
    hints: { dosePlaceholder: "1 capsule", quantityUnit: "capsules", route: "Oral" },
  },
  {
    match: ["tablet", "tab"],
    hints: { dosePlaceholder: "1 tablet", quantityUnit: "tablets", route: "Oral" },
  },
];

export function dosageFormHints(form?: string | null): DosageFormHints {
  const normalized = form?.trim().toLowerCase();
  if (!normalized) return UNKNOWN;
  for (const rule of RULES)
    if (rule.match.some((keyword) => normalized.includes(keyword)))
      return rule.hints;
  return UNKNOWN;
}
