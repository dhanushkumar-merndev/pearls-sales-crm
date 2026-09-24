import { z } from "zod";

export const metaId = z.string().regex(/^\d{3,32}$/);
export const CRM_FIELDS = ["full_name", "phone_raw", "email", "city", "procedure_interest", "preferred_date", "message", "extra", "ignore"] as const;
export const fieldMappingSchema = z.record(z.string().max(200), z.enum(CRM_FIELDS));
export const metaLeadSchema = z.object({
  id: metaId, form_id: metaId, created_time: z.string().max(50),
  ad_id: metaId.optional(), ad_name: z.string().max(300).optional(),
  campaign_name: z.string().max(300).optional(), platform: z.string().max(30).optional(),
  field_data: z.array(z.object({ name: z.string().max(200), values: z.array(z.string().max(4000)).max(50) })).max(100),
});
const defaults: Record<string, typeof CRM_FIELDS[number]> = {
  full_name: "full_name", phone_number: "phone_raw", email: "email", city: "city",
};

export function normalizeLeadPhone(phone: string | undefined) {
  const digits = (phone ?? "").replace(/[\s()+-]/g, "");
  return /^(?:91)?[6-9]\d{9}$/.test(digits) ? digits.slice(-10) : null;
}

export function mapMetaLead(input: unknown, form: { form_id: string; page_id: string; field_mapping: unknown; default_procedure_interest: string | null }) {
  const lead = metaLeadSchema.parse(input);
  if (lead.form_id !== form.form_id) throw new Error("Lead form does not match the configured form.");
  if (!Number.isFinite(Date.parse(lead.created_time))) throw new Error("Invalid lead timestamp.");
  const mapping = fieldMappingSchema.parse(form.field_mapping);
  const fields: Record<string, string> = Object.create(null);
  const extra: Record<string, string[]> = Object.create(null);
  for (const field of lead.field_data) {
    const destination = mapping[field.name] ?? defaults[field.name] ?? "extra";
    if (destination === "ignore") continue;
    if (destination === "extra") extra[field.name] = field.values;
    else fields[destination] = field.values.join(", ").trim();
  }
  if (!fields.full_name && !fields.phone_raw && !fields.email) throw new Error("Lead has no mapped contact details.");
  return {
    leadgen_id: lead.id, form_id: lead.form_id, page_id: form.page_id,
    ad_id: lead.ad_id, ad_name: lead.ad_name, campaign_name: lead.campaign_name,
    created_time: lead.created_time, platform: lead.platform,
    ...fields, phone_normalized: normalizeLeadPhone(fields.phone_raw),
    procedure_interest: fields.procedure_interest || form.default_procedure_interest,
    extra, raw_field_data: lead.field_data,
  };
}

export const webhookSchema = z.object({
  object: z.literal("page"),
  entry: z.array(z.object({
    id: metaId,
    changes: z.array(z.object({ field: z.string().max(100), value: z.unknown() })).max(100),
  })).max(100),
});
export const leadEventSchema = z.object({ leadgen_id: metaId, form_id: metaId, page_id: metaId.optional() });
