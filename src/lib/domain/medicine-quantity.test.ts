import { describe, expect, it } from "vitest";
import {
  calculatePrescriptionQuantity,
  calculateStockUnits,
} from "./medicine-quantity";

describe("calculateStockUnits", () => {
  it("converts packs to individual tablets", () => {
    expect(calculateStockUnits(30, 4, 0)).toBe(120);
    expect(calculateStockUnits(30, 4, 5)).toBe(125);
  });

  it("rejects invalid pack values", () => {
    expect(calculateStockUnits(0, 4, 0)).toBeNull();
    expect(calculateStockUnits(30, -1, 0)).toBeNull();
    expect(calculateStockUnits(30, 1.5, 0)).toBeNull();
  });
});

describe("calculatePrescriptionQuantity", () => {
  it("calculates one tablet daily for 30 days", () => {
    expect(
      calculatePrescriptionQuantity({
        dose: "1 tablet",
        frequency: "OD (1-0-0)",
        duration: "30 days",
      }),
    ).toBe(30);
  });

  it("calculates one tablet four times daily for 30 days", () => {
    expect(
      calculatePrescriptionQuantity({
        dose: "1 tablet",
        frequency: "QID (1-1-1-1)",
        duration: "30 days",
      }),
    ).toBe(120);
    expect(
      calculatePrescriptionQuantity({
        dose: "1 tablet",
        frequency: "1-1-1-1",
        duration: "30 days",
      }),
    ).toBe(120);
  });

  it("supports fractional tablet doses and single-dose instructions", () => {
    expect(
      calculatePrescriptionQuantity({
        dose: "1/2 tablet",
        frequency: "BD (1-0-1)",
        duration: "7 days",
      }),
    ).toBe(7);
    expect(
      calculatePrescriptionQuantity({
        dose: "2 tablets",
        frequency: "STAT (single dose)",
        duration: "30 days",
      }),
    ).toBe(2);
  });

  it("leaves SOS, weekly and dose-range instructions manual", () => {
    expect(
      calculatePrescriptionQuantity({
        dose: "1 tablet",
        frequency: "SOS",
        duration: "SOS",
      }),
    ).toBeNull();
    expect(
      calculatePrescriptionQuantity({
        dose: "1 tablet",
        frequency: "WEEKLY",
        duration: "30 days",
      }),
    ).toBeNull();
    expect(
      calculatePrescriptionQuantity({
        dose: "2-3 tablets",
        frequency: "BD (1-0-1)",
        duration: "5 days",
      }),
    ).toBeNull();
  });

  it("calculates syrup, drop and unbounded-unit doses, not just tablets", () => {
    // Stock (and the medicine's own dosage form) is tracked in "pieces" —
    // tablets, capsules or ml — so a syrup dose works the same way a tablet
    // dose does: the leading number is the pieces, the word after it is
    // just a label.
    expect(
      calculatePrescriptionQuantity({
        dose: "5 ml",
        frequency: "TDS (1-1-1)",
        duration: "5 days",
      }),
    ).toBe(75);
    expect(
      calculatePrescriptionQuantity({
        dose: "0.75 unit",
        frequency: "OD (1-0-0)",
        duration: "10 days",
      }),
    ).toBe(8);
    // No unit word at all is just as valid as "1 tablet".
    expect(
      calculatePrescriptionQuantity({
        dose: "1",
        frequency: "QID (1-1-1-1)",
        duration: "5 days",
      }),
    ).toBe(20);
  });
});
