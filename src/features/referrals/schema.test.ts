import { describe, expect, it } from "vitest";
import { formatBps, leadPackageSchema, partnerSchema, percentToBps } from "./schema";
import { parseReferralQuery } from "./query";

describe("percentToBps", () => {
  it("converts percentages to exact basis points", () => {
    expect(percentToBps("10")).toBe(1000);
    expect(percentToBps("12.5")).toBe(1250);
    expect(percentToBps("0.05")).toBe(5);
    expect(percentToBps("100")).toBe(10000);
  });
  it("rejects anything outside 0–100 with two decimals", () => {
    for (const bad of ["100.01", "-1", "1.234", "abc", "101"]) expect(() => percentToBps(bad)).toThrow();
  });
});

describe("formatBps", () => {
  it("trims trailing zeros", () => {
    expect(formatBps(1000)).toBe("10%");
    expect(formatBps(1050)).toBe("10.5%");
    expect(formatBps(0)).toBe("0%");
    expect(formatBps(10000)).toBe("100%");
  });
});

describe("referral forms", () => {
  it("parses a partner with an optional mobile", () => {
    const parsed = partnerSchema.parse({ name: "Glow Salon", incentive: "7.5", phone: "" });
    expect(parsed.incentive).toBe(750);
    expect(partnerSchema.safeParse({ name: "Glow Salon", incentive: "5", phone: "12345" }).success).toBe(false);
  });
  it("stores package value in paise", () => {
    const parsed = leadPackageSchema.parse({ leadId: "6f1d1c9e-3b5a-4c1e-9f0a-2b7d8e9f0a1b", packageName: "Hydrafacial x3", packageValue: "15000.50", incentive: "10", payoutStatus: "pending" });
    expect(parsed.packageValue).toBe(1500050);
    expect(leadPackageSchema.safeParse({ ...parsed, packageValue: "12.345", leadId: parsed.leadId }).success).toBe(false);
  });
});

describe("parseReferralQuery", () => {
  it("defaults to the last 90 clinic days and drops unknown filters", () => {
    const query = parseReferralQuery({ source: "sms", status: "everything", partner: "not-a-uuid" }, new Date("2026-10-05T06:00:00Z"));
    expect(query).toMatchObject({ from: "2026-07-08", to: "2026-10-05", source: null, status: null, partner: null, page: 1 });
  });
  it("keeps valid filters", () => {
    const query = parseReferralQuery({ from: "2026-09-01", to: "2026-09-30", source: "referral", status: "incentive_due", page: "3" });
    expect(query).toMatchObject({ from: "2026-09-01", to: "2026-09-30", source: "referral", status: "incentive_due", page: 3 });
  });
});
