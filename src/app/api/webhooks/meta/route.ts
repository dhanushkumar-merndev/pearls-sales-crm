import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { constantTimeEqual, verifyMetaSignature } from "@/features/meta/security";
import { ingestLeadEvent, metaCredentials } from "@/features/meta/server";
import { leadEventSchema, webhookSchema } from "@/features/meta/mapping";

export const runtime = "nodejs";
const MAX_BODY = 256 * 1024;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    const { verifyToken } = await metaCredentials();
    const challenge = params.get("hub.challenge");
    if (params.get("hub.mode") !== "subscribe" || !challenge || challenge.length > 1000 || !constantTimeEqual(params.get("hub.verify_token") ?? "", verifyToken)) return new Response("Forbidden", { status: 403 });
    return new Response(challenge, { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  } catch { return new Response("Integration unavailable", { status: 503 }); }
}

export async function POST(request: Request) {
  let appSecret: string;
  try { ({ appSecret } = await metaCredentials()); } catch { return new Response("Integration unavailable", { status: 503 }); }
  if (!request.body || Number(request.headers.get("content-length")) > MAX_BODY) return new Response("Payload too large", { status: 413 });
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BODY) { await reader.cancel(); return new Response("Payload too large", { status: 413 }); }
      chunks.push(value);
    }
  } catch { return new Response("Invalid request", { status: 400 }); }
  const raw = Buffer.concat(chunks);
  if (!verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), appSecret)) return new Response("Forbidden", { status: 403 });
  let payload;
  try { payload = webhookSchema.parse(JSON.parse(raw.toString("utf8"))); } catch { return new Response("Invalid payload", { status: 400 }); }
  const db = createSupabaseAdminClient();
  try {
    for (const entry of payload.entry) for (const change of entry.changes) {
      if (change.field !== "leadgen") continue;
      const event = leadEventSchema.parse(change.value);
      if (event.page_id && event.page_id !== entry.id) return new Response("Page mismatch", { status: 400 });
      await ingestLeadEvent(event.leadgen_id, event.form_id, entry.id);
    }
    const { error } = await db.from("meta_integration").update({ last_webhook_at: new Date().toISOString(), last_error: null, last_error_at: null }).eq("id", true);
    if (error) throw new Error("Could not save webhook status.");
    return new Response("EVENT_RECEIVED");
  } catch {
    // No tokens, payloads, patient details or Graph API error bodies in logs.
    // Non-2xx lets Meta retry; the leadgen ID unique constraint deduplicates.
    await db.from("meta_integration").update({ last_error: "Lead delivery failed. Check the page token and field mapping, then retry sync.", last_error_at: new Date().toISOString() }).eq("id", true);
    return new Response("Delivery failed; retry", { status: 503 });
  }
}
