import { rupeesToPaise } from "@/lib/domain/money";
import {
  cellBoolean,
  cellText,
  formatRowLimit,
  isIsoDate,
  MAX_IMPORT_ROWS,
  type ImportErrorRow,
} from "@/lib/domain/bulk-import";

export const MEDICINE_IMPORT_HEADERS = [
  "medicine_name",
  "generic_name",
  "strength",
  "dosage_form",
  "manufacturer",
  "batch_number",
  "expiry_date",
  "opening_quantity",
  "units_per_pack",
  "purchase_price",
  "selling_price",
  "low_stock_threshold",
  "active",
] as const;
export type NormalizedMedicineImport = {
  medicine_name: string;
  generic_name: string;
  strength: string;
  dosage_form: string;
  manufacturer: string;
  batch_number: string;
  expiry_date: string;
  opening_quantity: number;
  purchase_price_paise: number | null;
  selling_price_paise: number;
  units_per_pack: number;
  low_stock_threshold: number;
  active: boolean;
};
export type { ImportErrorRow };
const text = cellText;
const validDate = isIsoDate;
export function validateMedicineImportRows(input: unknown[]): {
  valid: NormalizedMedicineImport[];
  invalid: ImportErrorRow[];
} {
  const valid: NormalizedMedicineImport[] = [];
  const invalid: ImportErrorRow[] = [];
  const identities = new Set<string>();
  input.slice(0, MAX_IMPORT_ROWS).forEach((source, index) => {
    const data = (source && typeof source === "object" ? source : {}) as Record<
      string,
      unknown
    >;
    const errors: string[] = [];
    const medicine_name = text(data.medicine_name);
    const dosage_form = text(data.dosage_form);
    const batch_number = text(data.batch_number);
    const expiry_date = text(data.expiry_date);
    const opening_quantity = Number(data.opening_quantity);
    const selling = text(data.selling_price);
    const threshold =
      text(data.low_stock_threshold) === ""
        ? 10
        : Number(data.low_stock_threshold);
    // opening_quantity is in PIECES; units_per_pack only says how many pieces
    // make one strip/box, and prices are per pack.
    const units_per_pack =
      text(data.units_per_pack) === "" ? 1 : Number(data.units_per_pack);
    if (!medicine_name) errors.push("medicine_name is required");
    if (!dosage_form) errors.push("dosage_form is required");
    if (!batch_number) errors.push("batch_number is required");
    if (!validDate(expiry_date)) errors.push("expiry_date must be YYYY-MM-DD");
    if (!Number.isInteger(opening_quantity) || opening_quantity < 0)
      errors.push("opening_quantity must be a whole number >= 0");
    if (!Number.isInteger(threshold) || threshold < 0)
      errors.push("low_stock_threshold must be a whole number >= 0");
    if (!Number.isInteger(units_per_pack) || units_per_pack < 1 || units_per_pack > 10_000)
      errors.push("units_per_pack must be a whole number from 1 to 10000");
    let selling_price_paise = 0;
    let purchase_price_paise: number | null = null;
    let active = true;
    try {
      selling_price_paise = rupeesToPaise(selling);
    } catch {
      errors.push("selling_price must be a non-negative INR amount");
    }
    if (text(data.purchase_price) !== "") {
      try {
        purchase_price_paise = rupeesToPaise(text(data.purchase_price));
      } catch {
        errors.push("purchase_price must be a non-negative INR amount");
      }
    }
    try {
      active = cellBoolean(data.active);
    } catch (error) {
      errors.push((error as Error).message);
    }
    const identity = [
      medicine_name,
      text(data.generic_name),
      text(data.strength),
      dosage_form,
      batch_number,
    ]
      .map((part) => part.toLowerCase().replace(/\s+/g, " ").trim())
      .join("|");
    if (identities.has(identity))
      errors.push("duplicate medicine and batch in this file");
    identities.add(identity);
    if (errors.length) {
      invalid.push({ row: index + 2, data, errors });
      return;
    }
    valid.push({
      medicine_name,
      generic_name: text(data.generic_name),
      strength: text(data.strength),
      dosage_form,
      manufacturer: text(data.manufacturer),
      batch_number,
      expiry_date,
      opening_quantity,
      purchase_price_paise,
      selling_price_paise,
      units_per_pack,
      low_stock_threshold: threshold,
      active,
    });
  });
  if (input.length > MAX_IMPORT_ROWS)
    invalid.push({
      row: MAX_IMPORT_ROWS + 2,
      data: {},
      errors: [`Maximum ${formatRowLimit()} data rows per upload`],
    });
  return { valid, invalid };
}
