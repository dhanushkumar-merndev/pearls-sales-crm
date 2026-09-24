import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/dal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { databaseIdSchema } from "@/lib/validation/database-id";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApiPermission("manageUsers");
  if (guard.response) return guard.response;
  const actor = guard.profile;
  const parsedId = databaseIdSchema.safeParse((await params).id);
  if (!parsedId.success)
    return NextResponse.json({ error: "Export unavailable" }, { status: 404 });
  const id = parsedId.data;
  const admin = createSupabaseAdminClient(); const { data } = await admin.from("export_jobs").select("object_path,status").eq("id", id).single();
  if (!data?.object_path || data.status !== "ready") return NextResponse.json({ error: "Export unavailable" }, { status: 404 });
  const { data: signed, error } = await admin.storage.from("hospital-exports").createSignedUrl(data.object_path, 60, { download: true }); if (error || !signed) return NextResponse.json({ error: "Download unavailable" }, { status: 500 });
  await admin.from("audit_logs").insert({ actor_user_id: actor.id, action: "EXPORT_DOWNLOADED", entity_type: "export_job", entity_id: id });
  const response = NextResponse.redirect(signed.signedUrl);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
