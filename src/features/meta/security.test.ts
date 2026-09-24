// @vitest-environment node
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, verifyMetaSignature } from "./security";
import { mapMetaLead, normalizeLeadPhone } from "./mapping";

describe("Meta credential and webhook boundaries", () => {
  const key = "a1".repeat(32);
  it("encrypts with a fresh IV and authenticates the secret context", () => {
    const first = encryptSecret("private-token", key, "page:123");
    expect(first).not.toContain("private-token");
    expect(encryptSecret("private-token", key, "page:123")).not.toBe(first);
    expect(decryptSecret(first, key, "page:123")).toBe("private-token");
    expect(() => decryptSecret(first, key, "page:456")).toThrow();
    expect(() => decryptSecret(first, "b2".repeat(32), "page:123")).toThrow();
    expect(() => encryptSecret("token", "short", "page:123")).toThrow();
  });
  it("rejects changed payloads, missing signatures and malformed digests", () => {
    const body = Buffer.from('{"object":"page"}');
    const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    expect(verifyMetaSignature(body, signature, "secret")).toBe(true);
    expect(verifyMetaSignature(Buffer.from('{"object":"page" }'), signature, "secret")).toBe(false);
    for (const invalid of [null, "sha256=00", `sha256=${"z".repeat(64)}`]) expect(verifyMetaSignature(body, invalid, "secret")).toBe(false);
  });
  it("maps explicit fields and preserves extra answers without treating foreign phones as Indian", () => {
    const mapped = mapMetaLead({ id: "123", form_id: "456", created_time: "2026-09-24T09:00:00+0530", field_data: [
      { name: "full_name", values: ["Test Enquiry"] }, { name: "phone_number", values: ["+44 9876543210"] },
      { name: "treatment", values: ["Consultation"] }, { name: "custom", values: ["Morning"] },
      { name: "discard", values: ["Ignored"] },
    ] }, { form_id: "456", page_id: "789", field_mapping: { treatment: "procedure_interest", discard: "ignore" }, default_procedure_interest: null });
    expect(mapped.phone_normalized).toBeNull();
    expect(mapped.procedure_interest).toBe("Consultation");
    expect(mapped.extra).toEqual({ custom: ["Morning"] });
    expect(normalizeLeadPhone("+91 98765 43210")).toBe("9876543210");
  });
  it("rejects leads fetched from a different form", () => {
    expect(() => mapMetaLead({ id: "123", form_id: "999", created_time: "2026-09-24", field_data: [] }, { form_id: "456", page_id: "789", field_mapping: {}, default_procedure_interest: null })).toThrow();
  });
});
