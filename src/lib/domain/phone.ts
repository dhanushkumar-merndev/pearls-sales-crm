export function normalizeIndianPhone(input: string) {
  const digits = input.replace(/\D/g, "");
  const normalized = digits.length > 10 ? digits.slice(-10) : digits;
  if (!/^[6-9]\d{9}$/.test(normalized)) {
    throw new Error("Enter a valid 10-digit Indian mobile number.");
  }
  return normalized;
}
