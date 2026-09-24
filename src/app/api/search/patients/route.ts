import { NextRequest, NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PatientSearchRow = {
  id: string;
  name: string;
  uhid: string;
  phone_normalized: string;
  dob: string | null;
  gender: string;
};

export async function GET(request: NextRequest) {
  const guard = await requireApiPermission("viewPatients");
  if (guard.response) return guard.response;
  const raw = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (raw.length < 2) return NextResponse.json({ items: [] });
  if (raw.length > 120)
    return NextResponse.json({ error: "Search is too long" }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_patients", {
    p_query: raw,
    p_limit: 15,
    p_offset: 0,
    p_include_visit_count: false,
    p_active_only: true,
  });
  if (error) return NextResponse.json({ error: "Search unavailable" }, { status: 500 });
  return NextResponse.json(
    {
      items: ((data ?? []) as PatientSearchRow[]).map((patient) => ({
        id: patient.id,
        name: patient.name,
        uhid: patient.uhid,
        phone_normalized: patient.phone_normalized,
        dob: patient.dob,
        gender: patient.gender,
      })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
