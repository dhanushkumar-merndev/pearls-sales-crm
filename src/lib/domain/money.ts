export function rupeesToPaise(value: string | number) {
  const normalized = typeof value === "number" ? String(value) : value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Enter a valid non-negative amount with up to 2 decimals.");
  }
  const [rupees, fraction = ""] = normalized.split(".");
  return Number.parseInt(rupees, 10) * 100 + Number.parseInt(fraction.padEnd(2, "0") || "0", 10);
}

export function formatInr(paise: number | bigint) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(Number(paise) / 100);
}

export function paymentSummary(totalDuePaise: number, payments: readonly number[]) {
  const totalCollectedPaise = payments.reduce((sum, item) => sum + item, 0);
  const balancePaise = Math.max(0, totalDuePaise - totalCollectedPaise);
  const status = totalCollectedPaise === 0 ? "unpaid" : balancePaise === 0 ? "paid" : "partially_paid";
  return { totalDuePaise, totalCollectedPaise, balancePaise, status } as const;
}

/**
 * Medicine is stocked in pieces but priced by the pack, so both figures are
 * derived from the pack price rather than stored separately.
 *
 * The line amount is rounded ONCE from the pack price, never by multiplying a
 * rounded piece price: a strip of 30 at ₹35 is 116.67 paise a tablet, and
 * 30 × 117 would bill ₹35.10 — ten paise of invented money on every strip.
 * These mirror the arithmetic in dispense_prescription, which is authoritative.
 */
export function piecePricePaise(packPricePaise: number, unitsPerPack: number) {
  return Math.round(packPricePaise / Math.max(unitsPerPack, 1));
}

export function lineAmountPaise(
  quantityPieces: number,
  packPricePaise: number,
  unitsPerPack: number,
) {
  return Math.round((quantityPieces * packPricePaise) / Math.max(unitsPerPack, 1));
}

/** "13 × 30 + 10" — how the pharmacist counts the shelf. */
export function packBreakdown(quantityPieces: number, unitsPerPack: number) {
  const pack = Math.max(unitsPerPack, 1);
  if (pack === 1) return null;
  const packs = Math.floor(quantityPieces / pack);
  const loose = quantityPieces % pack;
  return { packs, loose, label: `${packs} × ${pack}${loose ? ` + ${loose}` : ""}` };
}
