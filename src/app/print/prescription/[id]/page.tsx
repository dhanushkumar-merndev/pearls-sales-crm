import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { calculateAge, formatHospitalDate } from "@/lib/domain/date";
import { formatPrescriptionNumber } from "@/lib/domain/prescription";
import { formatInr } from "@/lib/domain/money";
import { PrintButton } from "@/components/shared/print-button";
import { HospitalLetterhead } from "@/components/shared/hospital-letterhead";
import { getHospitalIdentity } from "@/lib/print/hospital-identity.server";

// Keyed by prescription id, not visit id, so reprints from pharmacy and
// patient history resolve the same document.
type Rx = {
  prescription_number: number;
  created_at: string;
  doctors: {
    display_name: string;
    qualification: string | null;
    registration_number: string | null;
    specialization: string | null;
  } | null;
  prescription_items: Array<{
    medicine_name: string;
    dose: string | null;
    frequency: string | null;
    duration: string | null;
    route: string | null;
    notes: string | null;
  }>;
  // vitals/consultations each have a unique(visit_id) column, so PostgREST
  // embeds a single object (or null) here, never an array.
  visits: {
    created_at: string;
    patients: {
      name: string;
      uhid: string | null;
      phone_normalized: string;
      dob: string | null;
      gender: string;
    } | null;
    departments: { name: string } | null;
    vitals: {
      weight_kg: number | null;
      temperature_f: number | null;
      bp_systolic: number | null;
      bp_diastolic: number | null;
    } | null;
    consultations: {
      symptoms: string | null;
      history: string | null;
      examination: string | null;
      assessment: string | null;
      advice: string | null;
    } | null;
    test_orders: Array<{ test_name: string; notes: string | null; created_at: string }>;
  } | null;
};
export default async function PrescriptionPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("prescriptions")
    .select(
      "prescription_number,created_at,doctors(display_name,qualification,registration_number,specialization),prescription_items(medicine_name,dose,frequency,duration,route,notes),visits(created_at,patients(name,uhid,phone_normalized,dob,gender),departments(name),vitals(weight_kg,temperature_f,bp_systolic,bp_diastolic),consultations(symptoms,history,examination,assessment,advice),test_orders(test_name,notes,created_at))",
    )
    .eq("id", id)
    .single();
  if (error || !data) notFound();
  const rx = data as unknown as Rx;
  const visit = rx.visits;
  const patient = visit?.patients;
  const doctor = rx.doctors;
  if (!patient || !doctor) notFound();
  // Money is kept off the prescription unless the hospital explicitly opts in
  // (AGENTS.md 24). The fee itself lives on visits, which is column-restricted,
  // so it is read through the finance RPC only when the setting is on.
  const [{ data: printSettings }, identity] = await Promise.all([
    supabase
      .from("hospital_settings")
      .select("print_fee_on_prescription")
      .eq("id", true)
      .maybeSingle(),
    getHospitalIdentity(),
  ]);
  let feePaise: number | null = null;
  if (printSettings?.print_fee_on_prescription && visit) {
    const { data: finance } = await supabase.rpc("get_visit_financial_summaries", {
      p_visit_ids: [id],
    });
    const row = (finance ?? [])[0] as { fee_paise?: number } | undefined;
    feePaise = typeof row?.fee_paise === "number" ? row.fee_paise : null;
  }
  const v = visit?.vitals ?? null;
  const c = visit?.consultations ?? null;
  const testOrders = visit?.test_orders ?? [];
  const medicines = rx.prescription_items;
  const visitDate = visit?.created_at ?? rx.created_at;
  return (
    <main className="mx-auto min-h-screen max-w-[210mm] bg-white p-4 text-[11px] text-black sm:p-8">
      <div data-print-hidden className="mb-4 flex justify-end">
        <PrintButton label="Print Prescription" />
      </div>
      <article className="min-h-[270mm] border border-black/20 p-7 print:min-h-0 print:border-0 print:p-0">
        <header>
          <HospitalLetterhead identity={identity} logoSize={56} />
          <div className="my-3 h-1 bg-primary" />
        </header>
        {/* The consulting doctor's identity (name, qualification, registration)
            prints once, in the footer, so the top of the sheet stays purely
            hospital branding. */}
        <section className="grid grid-cols-2 gap-x-8 gap-y-1 border-b pb-3 sm:grid-cols-4">
          <p>
            <b>Name:</b> {patient.name}
          </p>
          <p>
            <b>Age/Gender:</b> {patient.dob ? calculateAge(patient.dob) : "—"} /{" "}
            {patient.gender}
          </p>
          <p>
            <b>Patient ID:</b> {patient.uhid ?? "—"}
          </p>
          <p>
            <b>Date:</b> {formatHospitalDate(visitDate)}
          </p>
          <p>
            <b>Prescription No:</b> {formatPrescriptionNumber(rx.prescription_number)}
          </p>
          <p>
            <b>Weight:</b> {v?.weight_kg ? `${v.weight_kg} kg` : "—"}
          </p>
          <p>
            <b>Temperature:</b>{" "}
            {v?.temperature_f != null ? `${v.temperature_f} °F` : "—"}
          </p>
          <p>
            <b>BP:</b>{" "}
            {v ? `${v.bp_systolic ?? "—"}/${v.bp_diastolic ?? "—"}` : "—"}
          </p>
        </section>
        <div className="space-y-3 py-4">
          {[
            ["Symptoms", c?.symptoms],
            ["History", c?.history],
            ["Examination", c?.examination],
            ["Assessment", c?.assessment],
          ]
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <section key={label}>
                <h3 className="font-bold uppercase tracking-wide text-primary">
                  {label}
                </h3>
                <p className="mt-1 whitespace-pre-wrap">{value}</p>
              </section>
            ))}
        </div>
        {testOrders.length ? (
          <section className="mb-4">
            <h3 className="mb-2 font-bold uppercase tracking-wide text-primary">
              Investigations
            </h3>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="border p-2 text-left">Test</th>
                  <th className="border p-2 text-left">Date</th>
                  <th className="border p-2 text-left">Notes</th>
                </tr>
              </thead>
              <tbody>
                {testOrders.map((test, index) => (
                  <tr key={`${test.test_name}-${index}`}>
                    <td className="border p-2">{test.test_name}</td>
                    <td className="border p-2">
                      {formatHospitalDate(test.created_at)}
                    </td>
                    <td className="border p-2">{test.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
        <section>
          <h3 className="mb-2 font-bold uppercase tracking-wide text-primary">
            Rx · Medicines
          </h3>
          {medicines.length ? (
            <table className="w-full border-collapse">
              <thead className="print:table-header-group">
                <tr>
                  {["Name", "Dose", "Timing", "Duration", "Route", "Notes"].map(
                    (h) => (
                      <th className="border p-2 text-left" key={h}>
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {medicines.map((item, index) => (
                  <tr
                    className="break-inside-avoid"
                    key={`${item.medicine_name}-${index}`}
                  >
                    <td className="border p-2 font-medium">
                      {item.medicine_name}
                    </td>
                    <td className="border p-2">{item.dose ?? "—"}</td>
                    <td className="border p-2">{item.frequency ?? "—"}</td>
                    <td className="border p-2">{item.duration ?? "—"}</td>
                    <td className="border p-2">{item.route ?? "—"}</td>
                    <td className="border p-2">{item.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="italic text-black/60">
              No medicines prescribed at this visit.
            </p>
          )}
        </section>
        {c?.advice ? (
          <section className="mt-4">
            <h3 className="font-bold uppercase tracking-wide text-primary">
              Advice
            </h3>
            <p className="mt-1 whitespace-pre-wrap">{c.advice}</p>
          </section>
        ) : null}
        {feePaise !== null ? (
          <section className="mt-4 border-t pt-2 text-right">
            <p>
              <b>Consultation fee:</b> {formatInr(feePaise)}
            </p>
          </section>
        ) : null}
        <footer className="mt-12 flex justify-between gap-6 border-t pt-3 text-[10px]">
          <div>
            <p className="font-semibold">
              {identity.name}
              {identity.tagline ? ` · ${identity.tagline}` : ""}
            </p>
            {identity.address ? <p>{identity.address}</p> : null}
            <p>{[identity.phone, identity.email].filter(Boolean).join(" · ")}</p>
            <p className="mt-1">Digital prescription</p>
          </div>
          <p className="text-right">
            <span className="font-semibold">{doctor.display_name}</span>
            <br />
            {[doctor.qualification, doctor.specialization ?? visit?.departments?.name]
              .filter(Boolean)
              .join(", ")}
            <br />
            Registration: {doctor.registration_number ?? "—"}
          </p>
        </footer>
      </article>
    </main>
  );
}
