import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const profile = await getCurrentProfile();
  const supabase = await createSupabaseServerClient();
  void profile;
  const { data, error } = await supabase.rpc("operational_data_signature");
  if (error)
    return NextResponse.json(
      { error: "Live updates unavailable" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  return NextResponse.json(
    { signature: data ?? "" },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
