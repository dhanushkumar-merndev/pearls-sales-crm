import { NextRequest, NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type MedicineRow = {
  id: string;
  brand_name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string;
  quantity: number;
  low_stock_threshold: number;
};
export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!["admin", "reception", "doctor", "op", "pharmacy"].includes(profile.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const q = request.nextUrl.searchParams.get("q")?.trim().toLowerCase() ?? "";
  if (q.length < 2) return NextResponse.json({ items: [] });
  if (q.length > 120)
    return NextResponse.json({ error: "Search is too long" }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("search_medicine_availability", { p_query: q, p_limit: 20 });
  if (error)
    return NextResponse.json({ error: "Search unavailable" }, { status: 500 });
  const items = ((data ?? []) as unknown as MedicineRow[]).map((item) => {
    const quantity = Number(item.quantity);
    const threshold = Number(item.low_stock_threshold);
    return {
      id: item.id,
      name: item.brand_name,
      generic: item.generic_name,
      strength: item.strength,
      form: item.dosage_form,
      quantity,
      availability:
        quantity <= 0
          ? "out_of_stock"
          : quantity <= threshold
            ? "low_stock"
            : "in_stock",
    };
  });
  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
