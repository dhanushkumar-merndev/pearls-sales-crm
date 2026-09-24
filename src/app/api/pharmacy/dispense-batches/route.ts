import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { databaseIdSchema } from "@/lib/validation/database-id";

const medicineIdsSchema = z.array(databaseIdSchema).min(1).max(50);

type BatchRow = {
  id: string;
  medicine_id: string;
  batch_number: string;
  expiry_date: string;
  quantity: number;
  selling_price_paise: number;
  units_per_pack: number;
};

export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!(["admin", "pharmacy"] as const).includes(profile.role as "admin" | "pharmacy")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = medicineIdsSchema.safeParse(
    [...new Set((request.nextUrl.searchParams.get("medicineIds") ?? "").split(","))]
      .map((id) => id.trim())
      .filter(Boolean),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid medicine list" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_dispense_batches_for_medicines", {
    p_medicine_ids: parsed.data,
  });
  if (error) {
    return NextResponse.json({ error: "Live stock unavailable" }, { status: 500 });
  }

  const batches = ((data ?? []) as unknown as BatchRow[]).map((batch) => ({
    id: batch.id,
    medicineId: batch.medicine_id,
    batchNumber: batch.batch_number,
    expiry: batch.expiry_date,
    quantity: Number(batch.quantity),
    pricePaise: Number(batch.selling_price_paise),
    unitsPerPack: Number(batch.units_per_pack ?? 1),
  }));
  return NextResponse.json(
    { batches },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}
