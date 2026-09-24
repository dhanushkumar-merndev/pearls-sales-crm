"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/dal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { databaseIdSchema } from "@/lib/validation/database-id";
import type { ActionState } from "@/types/hospital";
import { encryptSecret } from "./security";
import { CRM_FIELDS, fieldMappingSchema, metaId } from "./mapping";
import { graphRequest, ingestLeadEvent, integrationKey, metaCredentials, MetaRequestError, pageToken } from "./server";

const settingsPath = "/admin/integrations/meta";
function failed(error: unknown): ActionState {
  return { ok: false, message: error instanceof MetaRequestError ? error.message : "Could not complete the Meta update. Check the connection settings and retry." };
}
function success(message: string, cursor?: string): ActionState {
  revalidatePath(settingsPath); revalidatePath("/leads"); revalidatePath("/dashboard");
  return { ok: true, message, data: { cursor: cursor ?? "" } };
}

export async function saveMetaCredentials(_: ActionState, form: FormData): Promise<ActionState> {
  const actor = await requirePermission("manageIntegrations");
  const parsed = z.object({ appId: metaId, appSecret: z.string().trim().min(16).max(500), verifyToken: z.string().trim().min(24).max(200) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Enter the app ID, app secret and a verification token of at least 24 characters.", fieldErrors: parsed.error.flatten().fieldErrors };
  try {
    const key = integrationKey();
    const v = parsed.data;
    const db = createSupabaseAdminClient();
    const { error } = await db.rpc("save_meta_credentials", { p_actor: actor.id, p_app_id: v.appId, p_app_secret_enc: encryptSecret(v.appSecret, key, "meta:app-secret"), p_verify_token_enc: encryptSecret(v.verifyToken, key, "meta:verify-token") });
    if (error) throw error;
    return success("Credentials saved. Connect a page, then verify the callback in your Meta app.");
  } catch (error) { return failed(error); }
}

export async function connectMetaPage(_: ActionState, form: FormData): Promise<ActionState> {
  const actor = await requirePermission("manageIntegrations");
  const parsed = z.object({ pageId: metaId, accessToken: z.string().trim().min(20).max(4000) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Enter the page ID and page access token." };
  try {
    const { appId, appSecret } = await metaCredentials();
    const { pageId, accessToken } = parsed.data;
    const debug = await graphRequest<{ data: { app_id: string; is_valid: boolean } }>("debug_token", `${appId}|${appSecret}`, appSecret, { input_token: accessToken });
    if (!debug.data?.is_valid || debug.data.app_id !== appId) return { ok: false, message: "This token is invalid or belongs to a different Meta app." };
    const page = await graphRequest<{ id: string; name: string }>(pageId, accessToken, appSecret, { fields: "id,name" });
    if (page.id !== pageId) throw new Error("Page mismatch.");
    const subscribed = await graphRequest<{ success: boolean }>(`${pageId}/subscribed_apps`, accessToken, appSecret, { subscribed_fields: "leadgen" }, "POST");
    if (!subscribed.success) throw new Error("Subscription failed.");
    const db = createSupabaseAdminClient();
    const { error } = await db.rpc("save_meta_page", { p_actor: actor.id, p_page_id: pageId, p_name: page.name, p_token_enc: encryptSecret(accessToken, integrationKey(), `meta:page:${pageId}`) });
    if (error) throw error;
    return success("Page connected. Sync its lead forms to select which enquiries to receive.");
  } catch (error) { return failed(error); }
}

const pageInput = z.object({ pageId: metaId, cursor: z.string().max(2000).optional() });
const metaFormsSchema = z.object({
  data: z.array(z.object({ id: metaId, name: z.string().max(300), status: z.string().optional(), questions: z.array(z.object({ key: z.string().max(200), label: z.string().max(1000).optional(), type: z.string().optional() })).max(100).optional() })).max(100),
  paging: z.object({ next: z.string().optional(), cursors: z.object({ after: z.string().max(2000).optional() }).optional() }).optional(),
});
export async function syncMetaForms(_: ActionState, form: FormData): Promise<ActionState> {
  await requirePermission("manageIntegrations");
  const parsed = pageInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Choose a connected page." };
  try {
    const { appSecret } = await metaCredentials();
    const token = await pageToken(parsed.data.pageId);
    const result = metaFormsSchema.parse(await graphRequest<unknown>(`${parsed.data.pageId}/leadgen_forms`, token, appSecret, { fields: "id,name,status,questions", limit: "100", ...(parsed.data.cursor ? { after: parsed.data.cursor } : {}) }));
    const db = createSupabaseAdminClient();
    // Preserve assignment and mapping on resync; new forms stay disabled until configured.
    for (const f of result.data) {
      const existing = await db.from("meta_lead_forms").select("form_id").eq("form_id", f.id).maybeSingle();
      if (existing.error) throw existing.error;
      const values = { form_id: f.id, page_id: parsed.data.pageId, name: f.name, meta_status: f.status, questions: f.questions ?? [], last_synced_at: new Date().toISOString() };
      const saved = existing.data ? await db.from("meta_lead_forms").update(values).eq("form_id", f.id) : await db.from("meta_lead_forms").upsert({ ...values, active: false }, { onConflict: "form_id", ignoreDuplicates: true });
      if (saved.error) throw saved.error;
    }
    return success(`${result.data.length} forms synced. Configure and enable the forms you want to receive.`, result.paging?.next ? result.paging.cursors?.after : undefined);
  } catch (error) { return failed(error); }
}

export async function saveMetaForm(_: ActionState, form: FormData): Promise<ActionState> {
  const actor = await requirePermission("manageIntegrations");
  const parsed = z.object({ formId: metaId, assignmentMode: z.enum(["round_robin", "specific", "unassigned"]), assignTo: databaseIdSchema.or(z.literal("")), interest: z.string().trim().max(120), active: z.enum(["on", ""]).optional() }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Check the form settings." };
  const mapping = fieldMappingSchema.safeParse(Object.fromEntries([...form.entries()].filter(([key]) => key.startsWith("mapping:")).map(([key, value]) => [key.slice(8), value])));
  if (!mapping.success) return { ok: false, message: `Choose a supported destination: ${CRM_FIELDS.join(", ")}.` };
  const v = parsed.data;
  const db = createSupabaseAdminClient();
  if (v.assignmentMode === "specific") {
    const owner = await db.from("profiles").select("id").eq("id", v.assignTo || "00000000-0000-0000-0000-000000000000").eq("role", "sales_executive").eq("status", "active").maybeSingle();
    if (owner.error || !owner.data) return { ok: false, message: "Choose an active sales executive." };
  }
  const { error, data } = await db.from("meta_lead_forms").update({ field_mapping: mapping.data, assignment_mode: v.assignmentMode, assign_to: v.assignmentMode === "specific" ? v.assignTo : null, default_procedure_interest: v.interest || null, active: v.active === "on" }).eq("form_id", v.formId).select("form_id").maybeSingle();
  if (error || !data) return { ok: false, message: "Form settings could not be saved. Sync forms and retry." };
  const audit = await db.from("audit_logs").insert({ actor_user_id: actor.id, action: "META_FORM_UPDATED", entity_type: "meta_integration", metadata: { form_id: v.formId, active: v.active === "on" } });
  if (audit.error) return { ok: true, message: "Settings saved, but the audit entry failed. Contact the administrator." };
  return success("Form settings saved.");
}

export async function backfillMetaLeads(_: ActionState, form: FormData): Promise<ActionState> {
  await requirePermission("manageIntegrations");
  const parsed = z.object({ formId: metaId, cursor: z.string().max(2000).optional() }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Choose an enabled lead form." };
  try {
    const db = createSupabaseAdminClient();
    const configured = await db.from("meta_lead_forms").select("page_id").eq("form_id", parsed.data.formId).eq("active", true).single();
    if (configured.error || !configured.data) throw new Error("Enable the form first.");
    const { appSecret } = await metaCredentials();
    const token = await pageToken(configured.data.page_id);
    const result = await graphRequest<{ data: { id: string }[]; paging?: { next?: string; cursors?: { after?: string } } }>(`${parsed.data.formId}/leads`, token, appSecret, { fields: "id", limit: "25", ...(parsed.data.cursor ? { after: parsed.data.cursor } : {}) });
    if (!Array.isArray(result.data) || result.data.length > 25) throw new Error("Invalid Meta result.");
    let imported = 0;
    for (const row of result.data) if (await ingestLeadEvent(metaId.parse(row.id), parsed.data.formId, configured.data.page_id) === "saved") imported++;
    const status = await db.from("meta_integration").update({ last_sync_at: new Date().toISOString(), last_error: null, last_error_at: null }).eq("id", true);
    if (status.error) throw status.error;
    return success(`${imported} enquiries imported; ${result.data.length - imported} already received or disabled.`, result.paging?.next ? result.paging.cursors?.after : undefined);
  } catch (error) { return failed(error); }
}
