import { NextRequest, NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Allergies already recorded across the patient register, most used first. */
export async function GET(request: NextRequest) {
  await getCurrentProfile();
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length > 120)
    return NextResponse.json({ error: "Search is too long" }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_known_allergies", {
    p_query: q || null,
    p_limit: 20,
  });
  if (error) return NextResponse.json({ items: [] });

  return NextResponse.json(
    { items: data ?? [] },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
