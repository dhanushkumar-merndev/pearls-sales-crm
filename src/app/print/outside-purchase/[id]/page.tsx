import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { calculateAge, formatHospitalDate } from "@/lib/domain/date";
import { formatPrescriptionNumber } from "@/lib/domain/prescription";
import { PrintButton } from "@/components/shared/print-button";
import { HospitalLetterhead } from "@/components/shared/hospital-letterhead";
import { getHospitalIdentity } from "@/lib/print/hospital-identity.server";

/**
 * The medicines the hospital pharmacy could not supply, on their own sheet.
 *
 * The receipt names them so the family knows what is outstanding, but an
 * outside chemist will not dispense against a receipt: they need a
 * prescription -- prescriber, registration number, patient, and each drug with
 * its dose, frequency and duration. That is what this is. It deliberately
 * carries no prices: nothing here was billed by the hospital.
 *
 * Keyed by prescription id, so pharmacy and patient history reprint the same
 * document.
 */
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
    requested_quantity: number | null;
    dispensed_quantity: number | null;
  }>;
  visits: {
    created_at: string;
    patients: {
      name: string;
      uhid: string | null;
      phone_normalized: string;
      dob: string | null;
      gender: string;
    } | null;
  } | null;
};

export default async function OutsidePurchasePrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("prescriptions")
    .select(
      "prescription_number,created_at,doctors(display_name,qualification,registration_number,specialization),prescription_items(medicine_name,dose,frequency,duration,route,notes,requested_quantity,dispensed_quantity),visits(created_at,patients(name,uhid,phone_normalized,dob,gender))",
    )
    .eq("id", id)
    .single();
  if (error || !data) notFound();
  const rx = data as unknown as Rx;
  const patient = rx.visits?.patients;
  const doctor = rx.doctors;
  if (!patient || !doctor) notFound();

  const pending = rx.prescription_items
    .map((item) => ({
      ...item,
      pending: (item.requested_quantity ?? 0) - (item.dispensed_quantity ?? 0),
    }))
    .filter((item) => item.pending > 0);
  const identity = await getHospitalIdentity();
  const date = rx.visits?.created_at ?? rx.created_at;

  return (
    <main className="mx-auto min-h-screen max-w-[210mm] bg-white p-4 text-[11px] text-black sm:p-8">
      <div data-print-hidden className="mb-4 flex justify-end">
        <PrintButton label="Print Outside Purchase Slip" />
      </div>
      <article className="border border-black/20 p-7 print:border-0 print:p-0">
        <header>
          <HospitalLetterhead identity={identity} logoSize={56} />
          <div className="my-3 h-1 bg-primary" />
        </header>
        <p className="border-y border-black py-2 text-center text-sm font-semibold uppercase">
          Outside Purchase Prescription
        </p>
        <section className="grid grid-cols-2 gap-x-8 gap-y-1 border-b pb-3 pt-3 sm:grid-cols-4">
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
            <b>Date:</b> {formatHospitalDate(date)}
          </p>
          <p>
            <b>Prescription No:</b> {formatPrescriptionNumber(rx.prescription_number)}
          </p>
        </section>

        {pending.length ? (
          <table className="mt-4 w-full border-collapse">
            <thead>
              <tr className="border-y border-black text-left">
                <th className="py-1.5 font-semibold">Medicine</th>
                <th className="py-1.5 font-semibold">Dose</th>
                <th className="py-1.5 font-semibold">Frequency</th>
                <th className="py-1.5 font-semibold">Duration</th>
                <th className="py-1.5 font-semibold">Route</th>
                <th className="py-1.5 text-right font-semibold">Qty</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((item, index) => (
                <tr className="border-b border-black/20" key={`${item.medicine_name}-${index}`}>
                  <td className="py-1.5 pr-2">
                    {item.medicine_name}
                    {item.notes ? (
                      <span className="block text-[10px]">{item.notes}</span>
                    ) : null}
                  </td>
                  <td className="py-1.5 pr-2">{item.dose ?? "—"}</td>
                  <td className="py-1.5 pr-2">{item.frequency ?? "—"}</td>
                  <td className="py-1.5 pr-2">{item.duration ?? "—"}</td>
                  <td className="py-1.5 pr-2">{item.route ?? "—"}</td>
                  <td className="py-1.5 text-right tabular-nums">{item.pending}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-6 text-center text-sm">
            Every medicine on this prescription was supplied by the hospital
            pharmacy. Nothing to purchase outside.
          </p>
        )}

        <p className="mt-4 text-[10px]">
          Not available at the hospital pharmacy on {formatHospitalDate(new Date().toISOString())}.
          Nothing on this sheet has been billed by the hospital.
        </p>

        <footer className="mt-10 flex justify-end">
          <div className="text-right">
            <div className="h-12" />
            <p className="border-t border-black pt-1 font-semibold">
              {doctor.display_name}
            </p>
            <p className="text-[10px]">
              {[doctor.qualification, doctor.specialization]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {doctor.registration_number ? (
              <p className="text-[10px]">Reg. No: {doctor.registration_number}</p>
            ) : null}
          </div>
        </footer>
      </article>
    </main>
  );
}
