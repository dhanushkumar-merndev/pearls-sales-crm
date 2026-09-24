"use client";

import { importPatients } from "./actions";
import {
  PATIENT_IMPORT_HEADERS,
  validatePatientImportRows,
  type NormalizedPatientImport,
} from "./import-schema";
import { BulkImportPanel } from "@/components/shared/bulk-import-panel";

export function BulkPatientImport() {
  return (
    <BulkImportPanel<NormalizedPatientImport>
      title="Validation summary"
      description="Existing phone numbers are skipped, never overwritten."
      templateHref="/api/patients/import/template"
      headers={PATIENT_IMPORT_HEADERS}
      validate={validatePatientImportRows}
      importChunk={(rows, fileName, key) => importPatients(rows, fileName, key)}
      errorFileName="patient-import-errors.csv"
      columns={[
        { key: "name", label: "Name", value: (row) => row.name },
        { key: "phone", label: "Mobile number", value: (row) => row.phone_normalized },
        { key: "gender", label: "Gender", value: (row) => row.gender },
        { key: "dob", label: "Date of birth", value: (row) => row.dob ?? "—" },
        { key: "blood_group", label: "Blood group", value: (row) => row.blood_group ?? "—" },
      ]}
    />
  );
}
