import { describe, expect, it } from "vitest";
import { lineAmountPaise, packBreakdown, piecePricePaise } from "./money";

describe("pack pricing", () => {
  it("bills a whole pack at exactly the pack price", () => {
    // ₹35 a strip of 30 is 116.67 paise a tablet; rounding per tablet first
    // would bill ₹35.10 for the strip.
    expect(lineAmountPaise(30, 3500, 30)).toBe(3500);
    expect(piecePricePaise(3500, 30) * 30).not.toBe(3500);
  });

  it("prices loose pieces pro rata", () => {
    expect(lineAmountPaise(10, 3500, 30)).toBe(1167);
    expect(lineAmountPaise(1, 3000, 30)).toBe(100);
  });

  it("treats a pack of one as a plain unit price", () => {
    expect(lineAmountPaise(7, 250, 1)).toBe(1750);
    expect(piecePricePaise(250, 1)).toBe(250);
    expect(packBreakdown(7, 1)).toBeNull();
  });

  it("describes stock the way the shelf is counted", () => {
    expect(packBreakdown(400, 30)?.label).toBe("13 × 30 + 10");
    expect(packBreakdown(390, 30)?.label).toBe("13 × 30");
  });

  it("never divides by zero when a pack size is missing", () => {
    expect(lineAmountPaise(5, 100, 0)).toBe(500);
    expect(piecePricePaise(100, 0)).toBe(100);
  });
});
