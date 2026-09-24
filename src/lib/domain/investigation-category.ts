export const INVESTIGATION_REPORT_CATEGORIES = [
  "Lab Report",
  "X-Ray / Radiology",
  "Scan",
  "Other",
] as const;

/**
 * Report uploads include documents such as prescriptions and discharge
 * summaries. A doctor ordering an investigation must only see categories that
 * can describe the result expected from that order.
 */
export function investigationReportCategories(configured: string[]) {
  const active = new Set(configured);
  return INVESTIGATION_REPORT_CATEGORIES.filter((name) => active.has(name));
}

/** Suggest the result type from the investigation name; the doctor can still override it. */
export function inferInvestigationReportCategory(
  testName: string,
  available: readonly string[],
) {
  const normalized = testName.trim().toLowerCase();
  let preferred = "Lab Report";

  if (/\b(x[ -]?ray|radiograph|mammograph|dexa)\b/.test(normalized)) {
    preferred = "X-Ray / Radiology";
  } else if (
    /\b(ct|hrct|mri|usg|ultrasound|ultrasonograph|doppler|scan|echocardiogram|echo)\b/.test(
      normalized,
    )
  ) {
    preferred = "Scan";
  }

  if (available.includes(preferred)) return preferred;
  if (available.includes("Other")) return "Other";
  return available[0] ?? "";
}
