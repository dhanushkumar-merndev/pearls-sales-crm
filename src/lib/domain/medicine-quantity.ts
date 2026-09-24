type PrescriptionQuantityInput = {
  dose: string;
  frequency: string;
  duration: string;
};

function parseDoseUnits(dose: string) {
  const trimmed = dose.trim();
  // The leading number is always "pieces" in the medicine's own unit —
  // tablets, capsules, ml, drops, units, whatever the dosage form is (stock
  // itself is tracked the same way, see medicine_batches.units_per_pack). A
  // bare "1" or "5 ml" is just as computable as "1 tablet"; the word after
  // the number, if any, is only a label and does not change the math. A dose
  // written as a range ("2-3 tablets") is left for the doctor to decide.
  const match = trimmed.match(/^(\d+\s*\/\s*\d+|\d+\.\d+|\d+)(?=\s|[a-zA-Z]|$)/);
  if (!match) return null;
  const [numerator, denominator] = match[1].replace(/\s+/g, "").split("/").map(Number);
  const units = denominator ? numerator / denominator : numerator;
  return Number.isFinite(units) && units > 0 && units <= 1000 ? units : null;
}

function dosesPerDay(frequency: string) {
  const normalized = frequency.trim().toUpperCase();
  if (!normalized || normalized.includes("SOS") || normalized.includes("WEEKLY"))
    return null;
  if (normalized.includes("STAT") || normalized.includes("SINGLE DOSE"))
    return { count: 1, singleDose: true };

  const schedule =
    normalized.match(/\((\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)+)\)/)?.[1] ??
    normalized.match(/^\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)+$/)?.[0];
  if (schedule) {
    const count = schedule.split("-").reduce((sum, value) => sum + Number(value), 0);
    if (Number.isFinite(count) && count > 0) return { count, singleDose: false };
  }

  const named: Record<string, number> = {
    OD: 1,
    BD: 2,
    TDS: 3,
    QID: 4,
    HS: 1,
    AFTERNOON: 1,
    EVENING: 1,
  };
  const written: Record<string, number> = {
    "ONCE DAILY": 1,
    "TWICE DAILY": 2,
    "THREE TIMES DAILY": 3,
    "EVERY 6 HOURS": 4,
    "EVERY 8 HOURS": 3,
    "EVERY 12 HOURS": 2,
  };
  if (written[normalized])
    return { count: written[normalized], singleDose: false };
  const prefix = normalized.split(/\s|\(/)[0];
  return named[prefix] ? { count: named[prefix], singleDose: false } : null;
}

function durationDays(duration: string) {
  const match = duration.trim().match(/^(\d+)\s*days?$/i);
  if (!match) return null;
  const days = Number(match[1]);
  return Number.isInteger(days) && days > 0 && days <= 3_650 ? days : null;
}

/**
 * Suggests the total quantity required — tablets, capsules, ml of syrup,
 * drops, whatever the medicine's own unit is — from the dose, frequency and
 * duration the doctor already typed. It deliberately refuses SOS, weekly,
 * dose ranges and other non-daily or ambiguous instructions: those remain a
 * doctor's manual quantity decision rather than a clinical interpretation.
 * The doctor can always overwrite the suggestion; "Enter manually" replaces
 * it the moment they type into the Qty field themselves.
 */
export function calculatePrescriptionQuantity({
  dose,
  frequency,
  duration,
}: PrescriptionQuantityInput) {
  const units = parseDoseUnits(dose);
  const frequencyValue = dosesPerDay(frequency);
  if (units === null || frequencyValue === null) return null;
  const days = frequencyValue.singleDose ? 1 : durationDays(duration);
  if (days === null) return null;
  const quantity = Math.ceil(units * frequencyValue.count * days);
  return quantity > 0 && quantity <= 100_000 ? quantity : null;
}

/** Converts full packs plus loose units into the individual stock unit count. */
export function calculateStockUnits(
  unitsPerPack: number,
  packs: number,
  looseUnits: number,
) {
  if (
    !Number.isInteger(unitsPerPack) ||
    !Number.isInteger(packs) ||
    !Number.isInteger(looseUnits) ||
    unitsPerPack < 1 ||
    packs < 0 ||
    looseUnits < 0
  )
    return null;
  const total = unitsPerPack * packs + looseUnits;
  return Number.isSafeInteger(total) && total <= 10_000_000 ? total : null;
}
