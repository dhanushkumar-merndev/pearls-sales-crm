// @vitest-environment node
import { createHmac } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ingest: vi.fn(), credentials: vi.fn(), status: vi.fn(),
}));
vi.mock("@/features/meta/server", () => ({ ingestLeadEvent: mocks.ingest, metaCredentials: mocks.credentials }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from: () => ({ update: () => ({ eq: mocks.status }) }) }),
}));
import { GET, POST } from "./route";

const secret = "test-app-secret";
const payload = { object: "page", entry: [{ id: "123", changes: [{ field: "leadgen", value: { leadgen_id: "456", form_id: "789", page_id: "123" } }] }] };
function request(body: unknown, signature = true) {
  const raw = JSON.stringify(body);
  return new Request("https://clinic.example/api/webhooks/meta", {
    method: "POST", body: raw,
    headers: signature ? { "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}` } : {},
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.credentials.mockResolvedValue({ appSecret: secret, verifyToken: "verification-secret" });
  mocks.ingest.mockResolvedValue("saved");
  mocks.status.mockResolvedValue({ error: null });
});
it("accepts verification only with the configured token and prevents caching", async () => {
  const response = await GET(new Request("https://clinic.example/api/webhooks/meta?hub.mode=subscribe&hub.challenge=123&hub.verify_token=verification-secret"));
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("123");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect((await GET(new Request("https://clinic.example/api/webhooks/meta?hub.mode=subscribe&hub.challenge=123&hub.verify_token=wrong"))).status).toBe(403);
});
it("rejects unsigned data before ingesting or recording delivery", async () => {
  expect((await POST(request(payload, false))).status).toBe(403);
  expect(mocks.ingest).not.toHaveBeenCalled();
  expect(mocks.status).not.toHaveBeenCalled();
});
it("ingests authenticated events and safely acknowledges duplicate deliveries", async () => {
  expect((await POST(request(payload))).status).toBe(200);
  expect(mocks.ingest).toHaveBeenCalledWith("456", "789", "123");
  mocks.ingest.mockResolvedValue("duplicate");
  expect((await POST(request(payload))).status).toBe(200);
});
it("returns a retryable response on downstream failure", async () => {
  mocks.ingest.mockRejectedValue(new Error("private upstream detail"));
  const response = await POST(request(payload));
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private");
});
it("rejects a mismatched page and an oversized body", async () => {
  const mismatch = structuredClone(payload);
  mismatch.entry[0].changes[0].value.page_id = "999";
  expect((await POST(request(mismatch))).status).toBe(400);
  expect((await POST(request("x".repeat(256 * 1024)))).status).toBe(413);
  expect(mocks.ingest).not.toHaveBeenCalled();
});
