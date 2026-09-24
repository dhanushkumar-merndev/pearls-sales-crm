/**
 * Shared limits for every spreadsheet import (medicines, patients, clinical
 * terms).
 *
 * MAX_IMPORT_ROWS is the hospital-facing promise: one file may carry up to
 * 10,000 data rows.
 *
 * IMPORT_CHUNK_SIZE is an implementation detail the user never sees. A server
 * action body is capped (~1 MB by default) and 10,000 rows of medicine data is
 * several times that, so the browser validates the whole file locally and then
 * ships it in chunks. Each chunk is one database transaction with its own
 * idempotency key, so a retry after a dropped connection re-sends only the
 * chunk that failed and never double-imports one that succeeded.
 */
export const MAX_IMPORT_ROWS = 10_000;
export const IMPORT_CHUNK_SIZE = 500;
export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;

export function chunkRows<T>(rows: T[], size = IMPORT_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

/**
 * A per-chunk idempotency key derived from the file's key: the last 12 hex
 * digits of the UUID carry the chunk index. Re-uploading the same file after a
 * failure regenerates the same keys, so chunks that already committed are
 * recognised as replays instead of being imported twice.
 */
export function chunkKey(baseKey: string, index: number) {
  return `${baseKey.slice(0, 24)}${index.toString(16).padStart(12, "0")}`;
}

/** "1,000" / "10,000" — used in UI copy and template instructions. */
export const formatRowLimit = (limit = MAX_IMPORT_ROWS) => limit.toLocaleString("en-IN");

export type ImportErrorRow = {
  row: number;
  data: Record<string, unknown>;
  errors: string[];
};

/**
 * Trimmed string from an untyped spreadsheet cell.
 *
 * A date typed into Excel (or even a plain "1990-01-01" in a CSV) is handed
 * back by the parser as a Date, whose default string form is locale junk like
 * "1/1/90". Dates are always read back as ISO, which is what every validator
 * and every database column expects.
 */
export const cellText = (value: unknown) => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    // Excel dates are wall-clock, not instants: read the local parts so a date
    // never slides a day backwards through a timezone conversion.
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return String(value ?? "").trim();
};

/**
 * Rows from the first sheet of an uploaded workbook, with every cell already
 * normalised to a string. Shared by all the importers so one spreadsheet quirk
 * cannot be fixed in one screen and left broken in another.
 */
export async function parseSpreadsheet(file: File): Promise<Record<string, unknown>[]> {
  if (!/\.(xlsx|csv)$/i.test(file.name)) {
    throw new Error("Only .xlsx and .csv files are supported.");
  }
  if (file.size < 1) throw new Error("The spreadsheet is empty.");
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    throw new Error("The spreadsheet must be 10 MB or smaller.");
  }
  // Loaded on demand: the parser is large and only import screens need it.
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
  return rows.map((row) => {
    const normalized: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(row)) normalized[column.trim()] = cellText(value);
    return normalized;
  });
}

export function cellBoolean(value: unknown, field = "active") {
  if (typeof value === "boolean") return value;
  const normalized = cellText(value).toLowerCase();
  if (normalized === "") return true;
  if (["true", "yes", "1", "active"].includes(normalized)) return true;
  if (["false", "no", "0", "inactive"].includes(normalized)) return false;
  throw new Error(`${field} must be TRUE or FALSE`);
}

export function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** CSV cell with quotes escaped, for the downloadable error report. */
export const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;

export function buildErrorCsv(headers: readonly string[], invalid: ImportErrorRow[]) {
  return [
    [...headers, "row_number", "errors"].map(csvCell).join(","),
    ...invalid.map((entry) =>
      [...headers.map((key) => entry.data[key]), entry.row, entry.errors.join("; ")]
        .map(csvCell)
        .join(","),
    ),
  ].join("\n");
}
