import { describe, expect, it } from "vitest";
import {
  cellBoolean,
  cellText,
  chunkKey,
  chunkRows,
  IMPORT_CHUNK_SIZE,
  isIsoDate,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_ROWS,
  parseSpreadsheet,
} from "./bulk-import";

describe("bulk import", () => {
  it("splits a full-size file into transaction-sized chunks", () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS }, (_, index) => index);
    const chunks = chunkRows(rows);
    expect(chunks).toHaveLength(MAX_IMPORT_ROWS / IMPORT_CHUNK_SIZE);
    expect(chunks.flat()).toHaveLength(MAX_IMPORT_ROWS);
    expect(chunks.every((chunk) => chunk.length <= IMPORT_CHUNK_SIZE)).toBe(true);
  });

  it("keeps a short file in one chunk and an empty file at none", () => {
    expect(chunkRows([1, 2, 3])).toEqual([[1, 2, 3]]);
    expect(chunkRows([])).toEqual([]);
  });

  it("derives a distinct, stable, valid UUID per chunk", () => {
    const base = "550e8400-e29b-41d4-a716-446655440000";
    const keys = Array.from({ length: 20 }, (_, index) => chunkKey(base, index));
    expect(new Set(keys).size).toBe(20);
    expect(chunkKey(base, 7)).toBe(chunkKey(base, 7));
    for (const key of keys) {
      expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it("reads an Excel date cell back as ISO, not locale junk", () => {
    // The parser hands back a Date for "1990-01-01"; String() would give
    // "1/1/90" and every row in the file would fail validation.
    expect(cellText(new Date(1990, 0, 1))).toBe("1990-01-01");
    expect(cellText(new Date(2027, 7, 31))).toBe("2027-08-31");
    expect(cellText(new Date("not a date"))).toBe("");
    expect(cellText("  spaced  ")).toBe("spaced");
    expect(cellText(null)).toBe("");
  });

  it("reads the spreadsheet booleans and dates staff actually type", () => {
    expect(cellBoolean("TRUE")).toBe(true);
    expect(cellBoolean("no")).toBe(false);
    expect(cellBoolean("")).toBe(true);
    expect(() => cellBoolean("maybe")).toThrow();
    expect(isIsoDate("2027-08-31")).toBe(true);
    expect(isIsoDate("31-08-2027")).toBe(false);
    expect(isIsoDate("2027-02-31")).toBe(false);
  });

  it("rejects unsupported, empty, and oversized files before parsing", async () => {
    await expect(parseSpreadsheet(new File(["x"], "import.txt"))).rejects.toThrow(
      "Only .xlsx and .csv",
    );
    await expect(parseSpreadsheet(new File([], "import.xlsx"))).rejects.toThrow(
      "empty",
    );
    const oversized = new File(
      [new Uint8Array(MAX_IMPORT_FILE_BYTES + 1)],
      "import.xlsx",
    );
    await expect(parseSpreadsheet(oversized)).rejects.toThrow("10 MB");
  });
});
