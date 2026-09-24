import { requireRoute } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SettingsForm } from "@/features/admin/settings-form";
import { StorageUsage, type BucketUsage } from "@/features/admin/storage-usage";
import { PageHeader } from "@/components/shared/page-header";

export default async function SettingsPage() {
  await requireRoute("/admin/settings");
  const supabase = await createSupabaseServerClient();
  const [{ data }, { data: usage }, { data: databaseBytes }] = await Promise.all([
    supabase
      .from("hospital_settings")
      .select(
        "hospital_name,tagline,address,phone,email,prescription_footer,token_footer,digital_prescription_text,print_fee_on_prescription",
      )
      .eq("id", true)
      .maybeSingle(),
    supabase.rpc("storage_usage_summary"),
    supabase.rpc("database_usage_bytes"),
  ]);
  const settings = data ?? {
    hospital_name: "Pearl Aesthetic & Wellness Clinic",
    tagline: null,
    address: null,
    phone: null,
    email: null,
    prescription_footer: null,
    token_footer: null,
    digital_prescription_text: null,
    print_fee_on_prescription: false,
  };

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Hospital identity, printable document text, and storage"
      />
      <SettingsForm settings={settings} />
      <StorageUsage
        buckets={(usage ?? []) as BucketUsage[]}
        databaseBytes={typeof databaseBytes === "number" ? databaseBytes : null}
      />
    </div>
  );
}
