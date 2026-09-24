import { NextRequest, NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type VisitRow = {
  visit_id: string;
  patient_id: string;
  patient_name: string;
  patient_phone: string;
  patient_uhid: string;
  token_number: number;
  status: string;
  doctor_name: string;
  fee_paise: number;
};

export async function GET(request: NextRequest) {
  const guard = await requireApiPermission("dispenseAsPerRx");
  if (guard.response) return guard.response;
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length > 120)
    return NextResponse.json({ error: "Search is too long" }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_today_op_visits_for_pharmacy", {
    p_query: q || null,
    p_limit: 30,
  });
  if (error) return NextResponse.json({ error: "Search unavailable" }, { status: 500 });
  return NextResponse.json(
    { items: (data ?? []) as VisitRow[] },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
