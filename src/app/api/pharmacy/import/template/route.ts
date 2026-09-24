import * as XLSX from "xlsx";
import { getCurrentProfile } from "@/lib/auth/dal";
import { MEDICINE_IMPORT_HEADERS } from "@/features/pharmacy/import-schema";
import { formatRowLimit } from "@/lib/domain/bulk-import";
export async function GET() {
  const profile = await getCurrentProfile();
  if (!["admin", "pharmacy"].includes(profile.role))
    return new Response("Forbidden", { status: 403 });
  const example = {
    medicine_name: "Paracetamol 500mg",
    generic_name: "Paracetamol",
    strength: "500 mg",
    dosage_form: "Tablet",
    manufacturer: "ABC Pharma",
    batch_number: "PCM-2026-A",
    expiry_date: "2027-08-31",
    opening_quantity: 500,
    purchase_price: 1.2,
    units_per_pack: 30,
    selling_price: 60,
    low_stock_threshold: 50,
    active: true,
  };
  const medicines = XLSX.utils.json_to_sheet([example], {
    header: [...MEDICINE_IMPORT_HEADERS],
  });
  const instructions = XLSX.utils.aoa_to_sheet([
    ["Pearl Aesthetic Medicine Import"],
    [
      "Required columns",
      "medicine_name, dosage_form, batch_number, expiry_date, opening_quantity, selling_price",
    ],
    ["expiry_date", "YYYY-MM-DD"],
    ["opening_quantity", "Whole number >= 0, counted in PIECES (tablets/capsules/ml)"],
    ["units_per_pack", "Pieces in one strip / box / bottle. Leave blank or 1 for loose items"],
    ["prices", "INR decimal values, for ONE PACK (a strip of 30 at Rs 60 = 60)"],
    ["active", "TRUE or FALSE"],
    ["limit", `Maximum ${formatRowLimit()} data rows per import`],
    ["existing batches", "Opening quantity is added only after confirmation"],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, medicines, "Medicines");
  XLSX.utils.book_append_sheet(workbook, instructions, "Instructions");
  const output = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return new Response(new Uint8Array(output), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        "attachment; filename=pearl-medicine-import-template.xlsx",
      "Cache-Control": "private, no-store",
    },
  });
}
