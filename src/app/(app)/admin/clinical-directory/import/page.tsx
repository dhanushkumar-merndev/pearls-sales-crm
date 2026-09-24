import { requireRoute } from "@/lib/auth/dal";
import { BulkClinicalImport } from "@/features/admin/clinical-bulk-import";
import { PageHeader } from "@/components/shared/page-header";

export default async function ClinicalImportPage() {
  await requireRoute("/admin/clinical-directory");
  return (
    <div>
      <PageHeader
        title="Bulk Clinical Directory Import"
        description="Load the hospital's own diagnoses, symptoms, investigations and advice lines — up to 10,000 rows per file"
      />
      <BulkClinicalImport />
    </div>
  );
}
