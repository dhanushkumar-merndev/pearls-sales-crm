"use client";

import { importClinicalTerms } from "./master-actions";
import {
  CLINICAL_IMPORT_HEADERS,
  validateClinicalImportRows,
  type NormalizedClinicalImport,
} from "./clinical-import-schema";
import { BulkImportPanel } from "@/components/shared/bulk-import-panel";

export function BulkClinicalImport() {
  return (
    <BulkImportPanel<NormalizedClinicalImport>
      title="Validation summary"
      description="Terms already in the directory are updated with the new wording and aliases."
      templateHref="/api/admin/clinical/import/template"
      headers={CLINICAL_IMPORT_HEADERS}
      validate={validateClinicalImportRows}
      importChunk={(rows, fileName, key) => importClinicalTerms(rows, fileName, key)}
      errorFileName="clinical-directory-import-errors.csv"
      columns={[
        { key: "term_type", label: "Type", value: (row) => row.term_type },
        { key: "display_text", label: "Term", value: (row) => row.display_text },
        { key: "code", label: "Code", value: (row) => row.code || "—" },
        { key: "code_system", label: "Code System", value: (row) => row.code_system || "—" },
        { key: "search_aliases", label: "Aliases", value: (row) => row.search_aliases.join(", ") || "—" },
        { key: "active", label: "Active", value: (row) => (row.active ? "Yes" : "No") },
      ]}
    />
  );
}
