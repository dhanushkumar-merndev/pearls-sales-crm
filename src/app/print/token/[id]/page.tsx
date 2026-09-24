import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/shared/print-button";
import { HospitalLetterhead } from "@/components/shared/hospital-letterhead";
import { getHospitalIdentity } from "@/lib/print/hospital-identity.server";

export default async function TokenPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("visits")
    .select(
      "patient_id,token_number,created_at,visit_date,patients(name,uhid,phone_normalized),doctors(display_name),departments(name)",
    )
    .eq("id", id)
    .single();
  if (error || !data) notFound();
  const visit = data as unknown as {
    token_number: number;
    patient_id: string;
    visit_date: string;
    created_at: string;
    patients: { name: string; uhid: string | null; phone_normalized: string } | null;
    doctors: { display_name: string } | null;
    departments: { name: string } | null;
  };
  // Every consultant the patient is registered with today. They are NOT matched
  // on token number: since each doctor issues from their own daily series, two
  // consultants in the same registration hold different numbers, and matching on
  // the number found only the doctor whose slip was being printed.
  const { data: consultantRows } = await supabase
    .from("visits")
    .select("id,token_number,doctors(display_name),departments(name)")
    .eq("patient_id", visit.patient_id)
    .eq("visit_date", visit.visit_date)
    .order("created_at");
  const identity = await getHospitalIdentity();
  const consultants = (consultantRows ?? []) as unknown as Array<{
    id: string;
    token_number: number;
    doctors: { display_name: string } | null;
    departments: { name: string } | null;
  }>;
  const multiple = consultants.length > 1;
  const doctorNames = visit.doctors?.display_name ?? "—";
  const departmentNames = visit.departments?.name ?? "—";
  const at = new Date(visit.created_at);
  return (
    // Wide enough for the two-column letterhead; still a slip, not a page.
    <main className="mx-auto min-h-screen max-w-md bg-white p-5 text-black">
      <div data-print-hidden className="mb-5 flex justify-end">
        <PrintButton label="Print Token" />
      </div>
      <article className="border border-black p-6 text-center font-sans">
        {/* Same banner as every other document the patient is handed. */}
        <HospitalLetterhead identity={identity} logoSize={48} className="text-left" />
        <div className="my-5 border-y border-black py-4">
          <p className="text-xs font-semibold uppercase">Token No</p>
          <p className="text-6xl font-bold">{visit.token_number}</p>
          {/* One patient, several consultants: each doctor runs their own daily
              series, so every token is listed rather than assuming one shared
              number. */}
          {multiple ? (
            <div className="mt-4 border-t border-black/30 pt-3">
              <p className="text-xs font-semibold uppercase">All consultants today</p>
              <ul className="mt-2 space-y-1">
                {consultants.map((row) => (
                  <li className="flex items-baseline justify-between gap-3 text-sm" key={row.id}>
                    <span className="text-left">
                      {row.doctors?.display_name ?? "—"}
                      <span className="block text-xs">{row.departments?.name ?? "—"}</span>
                    </span>
                    <span className="text-lg font-bold">#{row.token_number}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <dl className="grid grid-cols-[6rem_1fr] gap-y-3 text-left text-sm">
          <dt className="font-semibold">Patient</dt>
          <dd>{visit.patients?.name}</dd>
          <dt className="font-semibold">Patient ID</dt>
          <dd>{visit.patients?.uhid ?? "—"}</dd>
          <dt className="font-semibold">Mobile</dt>
          <dd>{visit.patients?.phone_normalized}</dd>
          <dt className="font-semibold">Doctor</dt>
          <dd>{multiple ? `${consultants.length} consultants (listed above)` : doctorNames}</dd>
          <dt className="font-semibold">Department</dt>
          <dd>{multiple ? "See list above" : departmentNames}</dd>
          <dt className="font-semibold">Date</dt>
          <dd>
            {at.toLocaleDateString("en-IN", {
              timeZone: "Asia/Kolkata",
              dateStyle: "medium",
            })}
          </dd>
          <dt className="font-semibold">Time</dt>
          <dd>
            {at.toLocaleTimeString("en-IN", {
              timeZone: "Asia/Kolkata",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </dd>
        </dl>
        <p className="mt-6 border-t border-dashed border-black pt-4 text-xs">
          Please wait until your token is called.
        </p>
      </article>
    </main>
  );
}
