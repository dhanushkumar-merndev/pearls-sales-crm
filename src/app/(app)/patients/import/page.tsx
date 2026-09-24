import { requireRoute } from "@/lib/auth/dal";
import { BulkPatientImport } from "@/features/patients/bulk-import";
import { PageHeader } from "@/components/shared/page-header";

export default async function PatientImportPage() {
  await requireRoute("/patients/import");
  return (
    <div>
      <PageHeader
        title="Bulk Patient Import"
        description="Move an existing patient register in: validate, preview, and import up to 10,000 Excel or CSV rows"
      />
      <BulkPatientImport />
    </div>
  );
}
