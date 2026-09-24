import {
  cellBoolean,
  cellText,
  formatRowLimit,
  MAX_IMPORT_ROWS,
  type ImportErrorRow,
} from "@/lib/domain/bulk-import";

export const CLINICAL_IMPORT_HEADERS = [
  "term_type",
  "display_text",
  "code",
  "code_system",
  "search_aliases",
  "active",
] as const;

export const CLINICAL_TERM_TYPES = [
  "symptom",
  "diagnosis",
  "investigation",
  "advice",
  "dosage_form",
  "route",
  "frequency",
  "duration",
] as const;

export type NormalizedClinicalImport = {
  term_type: string;
  display_text: string;
  code: string;
  code_system: string;
  search_aliases: string[];
  active: boolean;
};

/**
 * Validates a clinical directory sheet: the terms doctors pick from when typing
 * a diagnosis, symptom, investigation or advice line.
 *
 * Uniqueness is (term_type, normalized display_text), so the same word can
 * legitimately exist as both a symptom and a diagnosis; only a repeat within
 * one type is a duplicate.
 */
export function validateClinicalImportRows(input: unknown[]): {
  valid: NormalizedClinicalImport[];
  invalid: ImportErrorRow[];
} {
  const valid: NormalizedClinicalImport[] = [];
  const invalid: ImportErrorRow[] = [];
  const identities = new Set<string>();

  input.slice(0, MAX_IMPORT_ROWS).forEach((source, index) => {
    const data = (source && typeof source === "object" ? source : {}) as Record<string, unknown>;
    const errors: string[] = [];

    const term_type = cellText(data.term_type).toLowerCase();
    const display_text = cellText(data.display_text);

    if (!CLINICAL_TERM_TYPES.includes(term_type as (typeof CLINICAL_TERM_TYPES)[number])) {
      errors.push(`term_type must be one of ${CLINICAL_TERM_TYPES.join(", ")}`);
    }
    if (display_text.length < 2) errors.push("display_text is required");

    // Both optional, but only together -- a code with no system attached to
    // it (or a system with no code) is not useful, so the pair is dropped
    // rather than half-saved. This is how a hospital loads its own ICD-10,
    // SNOMED-CT, or any other coded terminology through the sheet.
    const code = cellText(data.code);
    const code_system = cellText(data.code_system);
    if (code && !code_system) errors.push("code_system is required when code is set");
    if (code_system && !code) errors.push("code is required when code_system is set");

    let active = true;
    try {
      active = cellBoolean(data.active);
    } catch (error) {
      errors.push((error as Error).message);
    }

    // Aliases let staff find a term by the abbreviation they actually say:
    // "URTI" for upper respiratory tract infection.
    const search_aliases = cellText(data.search_aliases)
      .split(/[|,;]/)
      .map((alias) => alias.trim())
      .filter(Boolean);

    const identity = `${term_type}|${display_text.toLowerCase().replace(/\s+/g, " ")}`;
    if (identities.has(identity)) errors.push("this term appears more than once in the file");
    identities.add(identity);

    if (errors.length) {
      invalid.push({ row: index + 2, data, errors });
      return;
    }
    valid.push({ term_type, display_text, code, code_system, search_aliases, active });
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
