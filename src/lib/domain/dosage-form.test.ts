import { describe, expect, it } from "vitest";
import { dosageFormHints } from "./dosage-form";

describe("dosageFormHints", () => {
  it("prompts ml for a syrup rather than a tablet", () => {
    expect(dosageFormHints("Syrup").dosePlaceholder).toBe("5 ml");
    expect(dosageFormHints("Syrup").quantityUnit).toBe("ml");
  });

  it("prompts ml and defaults to IV for an injection", () => {
    expect(dosageFormHints("Injection")).toEqual({
      dosePlaceholder: "1 ml",
      quantityUnit: "ml",
      route: "IV",
    });
  });

  it("prompts puffs for an inhaler", () => {
    expect(dosageFormHints("Inhaler").dosePlaceholder).toBe("2 puffs");
    expect(dosageFormHints("Inhaler").route).toBe("Inhalation");
  });

  it("keeps tablets and capsules on their own units", () => {
    expect(dosageFormHints("Tablet").dosePlaceholder).toBe("1 tablet");
    expect(dosageFormHints("Capsule").dosePlaceholder).toBe("1 capsule");
  });

  it("does not prompt a countable dose for a topical", () => {
    expect(dosageFormHints("Ointment").dosePlaceholder).toBe("Apply locally");
    expect(dosageFormHints("Cream").route).toBe("Topical");
  });

  it("matches the narrower form first", () => {
    // "Eye drops" contains neither "tablet" nor "syrup" but does contain
    // "drop"; "Dry syrup" must not fall through to the tablet rule.
    expect(dosageFormHints("Eye Drops").dosePlaceholder).toBe("2 drops");
    expect(dosageFormHints("Dry Syrup").dosePlaceholder).toBe("5 ml");
  });

  it("tolerates supplier free text and unknown forms", () => {
    expect(dosageFormHints("INJECTION (VIAL)").dosePlaceholder).toBe("1 ml");
    expect(dosageFormHints("  tab  ").dosePlaceholder).toBe("1 tablet");
    expect(dosageFormHints(null)).toEqual({
      dosePlaceholder: "Dose",
      quantityUnit: "units",
      route: null,
    });
    expect(dosageFormHints("").dosePlaceholder).toBe("Dose");
  });
});
