import { requireRoute } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { TablePagination, rangeFor } from "@/components/shared/table-pagination";
import { formatHospitalDate } from "@/lib/domain/date";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from "@/components/ui/table";
import { MetaConnectionForms, SyncFormsButton, ConfigureMetaForm, type MetaFormRow } from "@/features/meta/forms";

export default async function MetaPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireRoute("/admin/integrations/meta");
  const page = Math.min(100000, Math.max(1, Math.floor(Number((await searchParams).page)) || 1));
  const db = await createSupabaseServerClient();
  const [settings, pages, forms, owners] = await Promise.all([
    db.from("meta_integration").select("app_id,status,last_webhook_at,last_sync_at,last_error").eq("id", true).single(),
    db.from("meta_pages").select("page_id,name,subscribed").order("name").limit(100),
    db.from("meta_lead_forms").select("form_id,name,page_id,active,assignment_mode,assign_to,field_mapping,questions,default_procedure_interest", { count: "exact" }).order("name").order("form_id").range(...rangeFor(page)),
    db.from("profiles").select("id,full_name").eq("role", "sales_executive").eq("status", "active").order("full_name").limit(100),
  ]);
  if (settings.error || pages.error || forms.error || owners.error) throw new Error("Meta settings could not be loaded. Please retry.");
  const configured = /^[a-f0-9]{64}$/i.test(process.env.INTEGRATION_ENCRYPTION_KEY ?? "") && /^v\d+\.0$/.test(process.env.META_GRAPH_API_VERSION ?? "");
  const callback = process.env.NEXT_PUBLIC_APP_URL ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/webhooks/meta` : "/api/webhooks/meta";
  return <div className="space-y-4"><PageHeader title="Meta Lead Ads" description="Connect lead forms to the clinic’s enquiry workflow" />
    <Card><CardContent className="space-y-3 pt-5"><StatusBadge status={settings.data.status} /><p className="break-all text-sm">Webhook callback: {callback}</p><p className="text-sm text-muted-foreground">Last delivery: {settings.data.last_webhook_at ? formatHospitalDate(settings.data.last_webhook_at, true) : "No deliveries yet"} · Last import: {settings.data.last_sync_at ? formatHospitalDate(settings.data.last_sync_at, true) : "Never"}</p>{settings.data.last_error ? <Alert variant="destructive"><AlertDescription>{settings.data.last_error}</AlertDescription></Alert> : null}</CardContent></Card>
    <MetaConnectionForms appId={settings.data.app_id} enabled={configured} />
    <Card><CardHeader><CardTitle className="text-base">Connected pages</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Page</TableHead><TableHead>Page ID</TableHead><TableHead>Status</TableHead><TableHead>Action</TableHead></TableRow></TableHeader><TableBody>{pages.data.map((p) => <TableRow key={p.page_id}><TableCell>{p.name}</TableCell><TableCell>{p.page_id}</TableCell><TableCell><StatusBadge status={p.subscribed ? "active" : "inactive"} /></TableCell><TableCell>{p.subscribed ? <SyncFormsButton pageId={p.page_id} /> : "Reconnect this page"}</TableCell></TableRow>)}{!pages.data.length ? <TableRow><TableCell colSpan={4} className="h-20 text-center text-muted-foreground">No pages connected.</TableCell></TableRow> : null}</TableBody></Table></CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Lead forms</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Form</TableHead><TableHead>Status</TableHead><TableHead>Assignment</TableHead><TableHead>Action</TableHead></TableRow></TableHeader><TableBody>{(forms.data as MetaFormRow[]).map((f) => <TableRow key={f.form_id}><TableCell>{f.name}</TableCell><TableCell><StatusBadge status={f.active ? "active" : "inactive"} /></TableCell><TableCell className="capitalize">{f.assignment_mode.replaceAll("_", " ")}</TableCell><TableCell><ConfigureMetaForm form={f} owners={owners.data} /></TableCell></TableRow>)}{!forms.data.length ? <TableRow><TableCell colSpan={4} className="h-20 text-center text-muted-foreground">Sync a connected page to load its forms.</TableCell></TableRow> : null}</TableBody></Table><TablePagination page={page} total={forms.count ?? 0} noun="forms" /></CardContent></Card>
  </div>;
}
