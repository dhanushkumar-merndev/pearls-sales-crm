import { describe, expect, it } from "vitest";
import { resolveDob } from "./patient-input";

/**
 * Rural patients often know their age but not their birth date, so an age
 * becomes 1 January of the birth year and is flagged approximate.
 */

describe("resolveDob", () => {
  it("prefers an explicit date of birth and marks it exact", () => {
    expect(resolveDob("1994-03-11", "32")).toEqual({ dob: "1994-03-11", approximate: false });
  });

  it("derives an approximate dob from age when no date is given", () => {
    const year = new Date().getFullYear();
    expect(resolveDob(undefined, "32")).toEqual({ dob: `${year - 32}-01-01`, approximate: true });
  });

  it("treats a newborn age of 0 as valid", () => {
    const year = new Date().getFullYear();
    expect(resolveDob(undefined, "0")).toEqual({ dob: `${year}-01-01`, approximate: true });
  });

  it("returns no dob when neither is supplied", () => {
    expect(resolveDob(undefined, undefined)).toEqual({ dob: null, approximate: false });
  });

  it.each(["-1", "121", "abc", ""])("rejects invalid age %s", (age) => {
    expect(resolveDob(undefined, age)).toEqual({ dob: null, approximate: false });
  });
});
