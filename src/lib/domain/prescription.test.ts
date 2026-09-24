import { describe, expect, it } from "vitest";
import {
  formatPrescriptionNumber,
  parsePrescriptionNumber,
} from "./prescription";

describe("prescription numbers", () => {
  it("formats database sequence values for staff and patients", () => {
    expect(formatPrescriptionNumber(42)).toBe("RX-000042");
  });

  it.each(["42", "000042", "RX-000042", "rx # 42"])(
    "parses %s as the same searchable number",
    (value) => {
      expect(parsePrescriptionNumber(value)).toBe(42);
    },
  );

  it("rejects incomplete or unrelated identifiers", () => {
    expect(parsePrescriptionNumber("RX-")).toBeNull();
    expect(parsePrescriptionNumber("patient 42")).toBeNull();
  });
});
