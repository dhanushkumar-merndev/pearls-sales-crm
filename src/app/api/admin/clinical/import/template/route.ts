import * as XLSX from "xlsx";
import { getCurrentProfile } from "@/lib/auth/dal";
import { CLINICAL_IMPORT_HEADERS, CLINICAL_TERM_TYPES } from "@/features/admin/clinical-import-schema";
import { formatRowLimit } from "@/lib/domain/bulk-import";

export async function GET() {
  const profile = await getCurrentProfile();
  if (profile.role !== "admin") return new Response("Forbidden", { status: 403 });

  const examples = [
    {
      term_type: "diagnosis",
      display_text: "Upper respiratory tract infection",
      code: "J06.9",
      code_system: "ICD-10",
      search_aliases: "URTI | cold",
      active: true,
    },
    {
      term_type: "diagnosis",
      display_text: "Common cold",
      code: "82272006",
      code_system: "SNOMED-CT",
      search_aliases: "",
      active: true,
    },
  ];
  const terms = XLSX.utils.json_to_sheet(examples, { header: [...CLINICAL_IMPORT_HEADERS] });
  const instructions = XLSX.utils.aoa_to_sheet([
    ["Pearl Aesthetic Clinical Directory Import"],
    ["Required columns", "term_type, display_text"],
    ["term_type", CLINICAL_TERM_TYPES.join(", ")],
    ["code", "Optional. Any coding system's code -- ICD-10, SNOMED-CT, or the hospital's own. Requires code_system."],
    ["code_system", "Optional. e.g. ICD-10 or SNOMED-CT. Requires code. Blank on both leaves an uncoded, hospital-specific term."],
    ["search_aliases", "Optional. Separate with | or , so staff can search by abbreviation"],
    ["active", "TRUE or FALSE (blank means TRUE)"],
    ["limit", `Maximum ${formatRowLimit()} data rows per import`],
    ["existing terms", "A term already in the directory is updated, not duplicated. A blank code/code_system on re-import leaves the existing code untouched."],
  ]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, terms, "Clinical Terms");
  XLSX.utils.book_append_sheet(workbook, instructions, "Instructions");
  const output = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  return new Response(new Uint8Array(output), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=pearl-clinical-directory-template.xlsx",
      "Cache-Control": "private, no-store",
    },
  });
}
