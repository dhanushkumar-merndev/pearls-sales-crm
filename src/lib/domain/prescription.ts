const PRESCRIPTION_NUMBER_PATTERN = /^(?:RX\s*[-#]?\s*)?(\d+)$/i;

export function formatPrescriptionNumber(value: number | string) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) return "RX-—";
  return `RX-${String(number).padStart(6, "0")}`;
}

export function parsePrescriptionNumber(value: string) {
  const match = value.trim().match(PRESCRIPTION_NUMBER_PATTERN);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
