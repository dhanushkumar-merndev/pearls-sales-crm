import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { databaseIdSchema } from "@/lib/validation/database-id";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await getCurrentProfile();
  const parsedId = databaseIdSchema.safeParse((await params).id);
  if (!parsedId.success)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const id = parsedId.data;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("patient_reports")
    .select("object_path")
    .eq("id", id)
    .single();
  if (error || !data)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: signed, error: signError } = await supabase.storage
    .from("patient-documents")
    .createSignedUrl(data.object_path, 60);
  if (signError || !signed)
    return NextResponse.json({ error: "File unavailable" }, { status: 500 });
  await createSupabaseAdminClient()
    .from("audit_logs")
    .insert({
      actor_user_id: profile.id,
      action: "REPORT_VIEWED",
      entity_type: "patient_report",
      entity_id: id,
    });
  const response = NextResponse.redirect(signed.signedUrl);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
