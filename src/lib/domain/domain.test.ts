import { describe, expect, it } from "vitest";
import { normalizeIndianPhone } from "./phone";
import { formatInr, paymentSummary, rupeesToPaise } from "./money";
import { remainingPrescriptionQuantity, stockStatus } from "./stock";
import { formatTokenNumber } from "./date";

describe("hospital domain rules", () => {
  it("normalizes Indian phone numbers to the final ten digits", () => {
    expect(normalizeIndianPhone("+91 98765 43210")).toBe("9876543210");
    expect(() => normalizeIndianPhone("12345")).toThrow(/valid 10-digit/);
  });
  it("converts money without floating point storage", () => {
    expect(rupeesToPaise("500.25")).toBe(50025);
    expect(rupeesToPaise("0.05")).toBe(5);
    expect(formatInr(50000)).toContain("500");
  });
  it("derives append-only payment totals", () => {
    expect(paymentSummary(50000, [30000, 20000])).toMatchObject({ totalCollectedPaise: 50000, balancePaise: 0, status: "paid" });
    expect(paymentSummary(50000, [30000]).status).toBe("partially_paid");
  });
  it("calculates stock and partial dispensing", () => {
    expect(stockStatus(0, 10)).toBe("out_of_stock");
    expect(stockStatus(8, 10)).toBe("low_stock");
    expect(remainingPrescriptionQuantity(10, 6)).toBe(4);
    expect(() => remainingPrescriptionQuantity(10, 11)).toThrow();
  });
  it("rejects invalid tokens", () => {
    expect(formatTokenNumber(12)).toBe("12");
    expect(() => formatTokenNumber(0)).toThrow();
  });
});
