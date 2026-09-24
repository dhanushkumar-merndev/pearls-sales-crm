import { describe, expect, it } from "vitest";
import {
  inferInvestigationReportCategory,
  investigationReportCategories,
} from "./investigation-category";

const configured = [
  "Clinical Photo",
  "Discharge Summary",
  "IP Document",
  "Lab Report",
  "Other",
  "Prescription",
  "Scan",
  "X-Ray / Radiology",
];

describe("investigation report categories", () => {
  it("removes unrelated document-upload categories", () => {
    expect(investigationReportCategories(configured)).toEqual([
      "Lab Report",
      "X-Ray / Radiology",
      "Scan",
      "Other",
    ]);
  });

  it("classifies blood screening as a lab report", () => {
    expect(inferInvestigationReportCategory("HIV screening", configured)).toBe(
      "Lab Report",
    );
  });

  it("classifies radiology and scan investigations", () => {
    expect(inferInvestigationReportCategory("X-Ray chest PA", configured)).toBe(
      "X-Ray / Radiology",
    );
    expect(inferInvestigationReportCategory("CT brain - plain", configured)).toBe(
      "Scan",
    );
  });
});
