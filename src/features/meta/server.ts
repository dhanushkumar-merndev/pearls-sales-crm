import "server-only";
import { createHmac } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "./security";
import { mapMetaLead, metaId } from "./mapping";

export function integrationKey() {
  const key = process.env.INTEGRATION_ENCRYPTION_KEY ?? "";
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error("Configure INTEGRATION_ENCRYPTION_KEY before connecting Meta.");
  return key;
}

export async function metaCredentials() {
  const db = createSupabaseAdminClient();
  const [settings, secrets] = await Promise.all([
    db.from("meta_integration").select("app_id,status").eq("id", true).single(),
    db.from("meta_integration_secrets").select("app_secret_enc,verify_token_enc").eq("id", true).maybeSingle(),
  ]);
  if (settings.error || secrets.error || !settings.data?.app_id || !secrets.data?.app_secret_enc || !secrets.data?.verify_token_enc) throw new Error("Meta credentials are not configured.");
  const key = integrationKey();
  return { appId: settings.data.app_id as string,
    appSecret: decryptSecret(secrets.data.app_secret_enc, key, "meta:app-secret"),
    verifyToken: decryptSecret(secrets.data.verify_token_enc, key, "meta:verify-token") };
}

export class MetaRequestError extends Error {
  constructor(readonly code?: number) { super(code === 190 ? "Meta token has expired or is invalid. Reconnect the page." : "Meta request failed. Check the page token and Lead Ads permissions."); }
}

export async function graphRequest<T>(path: string, token: string, appSecret: string, params: Record<string, string> = {}, method: "GET" | "POST" = "GET"): Promise<T> {
  const version = process.env.META_GRAPH_API_VERSION;
  if (!version || !/^v\d+\.0$/.test(version)) throw new Error("Configure META_GRAPH_API_VERSION with a supported version from your Meta app.");
  if (!/^(?:\d{3,32}|debug_token)(?:\/(?:leadgen_forms|leads|subscribed_apps))?$/.test(path)) throw new Error("Invalid Meta endpoint.");
  const url = new URL(`https://graph.facebook.com/${version}/${path}`);
  const query = new URLSearchParams({ ...params, appsecret_proof: createHmac("sha256", appSecret).update(token).digest("hex") });
  if (method === "GET") url.search = query.toString();
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) }, body: method === "POST" ? query : undefined, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) });
  const body = await response.json() as T & { error?: { code?: number } };
  if (!response.ok || body.error) throw new MetaRequestError(body.error?.code);
  return body;
}

export async function pageToken(pageId: string) {
  metaId.parse(pageId);
  const db = createSupabaseAdminClient();
  const { data, error } = await db.from("meta_page_secrets").select("access_token_enc").eq("page_id", pageId).maybeSingle();
  if (error || !data) throw new Error("Reconnect this Meta page before syncing.");
  return decryptSecret(data.access_token_enc, integrationKey(), `meta:page:${pageId}`);
}

export async function ingestLeadEvent(leadId: string, formId: string, pageId: string) {
  const db = createSupabaseAdminClient();
  const { data: form, error } = await db.from("meta_lead_forms").select("form_id,page_id,active,field_mapping,default_procedure_interest").eq("form_id", formId).eq("page_id", pageId).maybeSingle();
  if (error) throw new Error("Cannot load Meta form configuration.");
  if (!form?.active) return "ignored";
  const { data: page, error: pageError } = await db.from("meta_pages").select("subscribed").eq("page_id", pageId).maybeSingle();
  if (pageError) throw new Error("Cannot load Meta page configuration.");
  if (!page?.subscribed) return "ignored";
  const existing = await db.from("leads").select("id").eq("meta_leadgen_id", leadId).maybeSingle();
  if (existing.error) throw new Error("Cannot check lead delivery.");
  if (existing.data) return "duplicate";
  const { appSecret } = await metaCredentials();
  const token = await pageToken(pageId);
  const raw = await graphRequest<unknown>(metaId.parse(leadId), token, appSecret, { fields: "id,form_id,created_time,field_data,ad_id,ad_name,campaign_name,platform" });
  const mapped = mapMetaLead(raw, form);
  if (mapped.leadgen_id !== leadId) throw new Error("Meta returned a different lead.");
  const saved = await db.rpc("ingest_meta_lead", { p_lead: mapped });
  if (saved.error) throw new Error("Could not save Meta enquiry.");
  return "saved";
}
