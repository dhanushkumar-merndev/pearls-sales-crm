import { describe, expect, it } from "vitest";
import { clinicDateTime, leadNoteSchema, leadStatusSchema, manualLeadSchema } from "./schema";

const leadId = "11000000-0000-0000-0000-000000000001";
describe("lead input boundaries", () => {
  it("stores clinic times with the IST offset, independent of the machine timezone", () => {
    expect(clinicDateTime.parse("2026-09-24T09:00")).toBe("2026-09-24T03:30:00.000Z");
    expect(clinicDateTime.parse("2026-09-24T00:15")).toBe("2026-09-23T18:45:00.000Z");
  });
  it.each(["2026-02-30T12:00", "2026-09-24T24:01", "2026-13-01T10:00", "nonsense", "2026-09-24T10:00Z"])("rejects an invalid local date: %s", (value) => {
    expect(clinicDateTime.safeParse(value).success).toBe(false);
  });
  it("accepts Indian phone formatting but not arbitrary foreign prefixes or text", () => {
    const base = { fullName: "Test Person", idempotencyKey: leadId };
    for (const phone of ["9876543210", "+91 98765 43210", "(91) 98765-43210"]) expect(manualLeadSchema.safeParse({ ...base, phone }).success).toBe(true);
    for (const phone of ["+44 9876543210", "09876543210", "phone9876543210", "1234567890"]) expect(manualLeadSchema.safeParse({ ...base, phone }).success).toBe(false);
  });
  it("requires a lost reason and prevents bypassing booking/conversion", () => {
    expect(leadStatusSchema.safeParse({ leadId, status: "lost" }).success).toBe(false);
    expect(leadStatusSchema.safeParse({ leadId, status: "lost", lostReason: "Not interested" }).success).toBe(true);
    for (const status of ["booked", "converted"]) expect(leadStatusSchema.safeParse({ leadId, status }).success).toBe(false);
  });
  it("accepts a follow-up change without a note, but rejects empty activity", () => {
    expect(leadNoteSchema.safeParse({ leadId, type: "call", body: " " }).success).toBe(false);
    expect(leadNoteSchema.safeParse({ leadId, type: "note", nextFollowUpAt: "2026-09-25T09:00" }).success).toBe(true);
    expect(leadNoteSchema.safeParse({ leadId, type: "note", clearFollowUp: "on" }).success).toBe(true);
  });
});
