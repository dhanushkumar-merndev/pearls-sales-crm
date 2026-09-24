import { describe, expect, it } from "vitest";
import {
  containsSearchPattern,
  prefixSearchPattern,
  searchDigits,
} from "./search";

describe("table search normalization", () => {
  it("normalizes multi-word terms without allowing PostgREST separators", () => {
    expect(containsSearchPattern("  Dr. Rao, admin  ")).toBe(
      "%Dr.%Rao%admin%",
    );
    expect(prefixSearchPattern("General Medicine")).toBe("General%Medicine%");
  });

  it("extracts searchable phone and token digits", () => {
    expect(searchDigits("+91 98765-43210")).toBe("919876543210");
  });
});
