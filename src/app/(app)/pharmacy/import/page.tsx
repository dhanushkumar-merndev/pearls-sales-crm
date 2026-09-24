import { requireRoute } from "@/lib/auth/dal";
import { BulkMedicineImport } from "@/features/pharmacy/bulk-import";
import { PageHeader } from "@/components/shared/page-header";
export default async function BulkImportPage() {
  await requireRoute("/pharmacy");
  return (
    <div>
      <PageHeader
        title="Bulk Medicine Import"
        description="Validate, preview, and transactionally import up to 10,000 Excel or CSV rows"
      />
      <BulkMedicineImport />
    </div>
  );
}
