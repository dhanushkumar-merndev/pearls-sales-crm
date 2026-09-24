import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatInr } from "@/lib/domain/money";
import { formatPrescriptionNumber } from "@/lib/domain/prescription";
import { PrintButton } from "@/components/shared/print-button";
import { HospitalLetterhead } from "@/components/shared/hospital-letterhead";
import { getHospitalIdentity } from "@/lib/print/hospital-identity.server";

type Receipt = {
  sale_id: string;
  created_at: string;
  source: string;
  payment_mode: string | null;
  dispensed_by: string | null;
  patient_name: string | null;
  patient_phone: string | null;
  patient_uhid: string | null;
  visit_id: string | null;
  token_number: number | null;
  prescription_id: string | null;
  prescription_number: number | null;
  doctor_name: string | null;
  medicines_paise: number;
  consultation_paise: number;
  items: Array<{
    name: string;
    batch: string | null;
    quantity: number;
    unit_price_paise: number;
    amount_paise: number;
  }>;
  /** Prescribed but not handed over -- the family buys these outside. */
  unsupplied: Array<{
    name: string;
    dose: string | null;
    frequency: string | null;
    duration: string | null;
    pending: number;
  }>;
};

const MODE_LABELS: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  bank_transfer: "Bank Transfer",
  other: "Other",
};

/**
 * Counter receipt for one dispense.
 *
 * A single counter visit can carry two charges: the medicines, and the
 * consultation fee the doctor set which is collected at the same time. Both are
 * printed on one receipt so the patient gets a single proof of payment; the fee
 * line simply does not appear when it was collected elsewhere.
 */
export default async function ReceiptPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_sale_receipt", { p_sale_id: id });
  const receipt = (Array.isArray(data) ? data[0] : data) as Receipt | undefined;
  if (error || !receipt) notFound();

  const identity = await getHospitalIdentity();
  const at = new Date(receipt.created_at);
  const total = Number(receipt.medicines_paise) + Number(receipt.consultation_paise);
  const items = receipt.items ?? [];
  const unsupplied = receipt.unsupplied ?? [];

  return (
    <main className="mx-auto min-h-screen max-w-[210mm] bg-white p-4 text-black sm:p-8">
      <div data-print-hidden className="mb-4 flex justify-end gap-2">
        {unsupplied.length && receipt.prescription_id ? (
          <a
            className="inline-flex items-center rounded-md border px-3 py-2 text-sm font-medium"
            href={`/print/outside-purchase/${receipt.prescription_id}`}
          >
            Outside Purchase Slip
          </a>
        ) : null}
        <PrintButton label="Print Receipt" />
      </div>
      <article className="mx-auto max-w-md border border-black p-6 font-sans">
        <HospitalLetterhead identity={identity} logoSize={48} />
        <p className="mt-4 border-y border-black py-2 text-center text-sm font-semibold uppercase">
          Payment Receipt
        </p>

        <dl className="mt-4 grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
          <dt className="font-semibold">Receipt No</dt>
          <dd className="font-mono">{receipt.sale_id.slice(0, 8).toUpperCase()}</dd>
          <dt className="font-semibold">Date</dt>
          <dd>
            {at.toLocaleString("en-IN", {
              timeZone: "Asia/Kolkata",
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </dd>
          <dt className="font-semibold">Patient</dt>
          <dd>{receipt.patient_name ?? "—"}</dd>
          <dt className="font-semibold">Patient ID</dt>
          <dd className="font-mono">{receipt.patient_uhid ?? "—"}</dd>
          {receipt.patient_phone ? (
            <>
              <dt className="font-semibold">Mobile</dt>
              <dd>{receipt.patient_phone}</dd>
            </>
          ) : null}
          {receipt.doctor_name ? (
            <>
              <dt className="font-semibold">Doctor</dt>
              <dd>{receipt.doctor_name}</dd>
            </>
          ) : null}
          {receipt.token_number ? (
            <>
              <dt className="font-semibold">Token</dt>
              <dd>#{receipt.token_number}</dd>
            </>
          ) : null}
          {receipt.prescription_number ? (
            <>
              <dt className="font-semibold">Prescription</dt>
              <dd className="font-mono">
                {formatPrescriptionNumber(receipt.prescription_number)}
              </dd>
            </>
          ) : null}
        </dl>

        {items.length ? (
          <table className="mt-5 w-full border-collapse text-sm">
            <thead>
              <tr className="border-y border-black text-left">
                <th className="py-1.5 font-semibold">Medicine</th>
                <th className="py-1.5 text-right font-semibold">Qty</th>
                <th className="py-1.5 text-right font-semibold">Rate</th>
                <th className="py-1.5 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr className="border-b border-black/20" key={`${item.name}-${index}`}>
                  <td className="py-1.5 pr-2">
                    {item.name}
                    {item.batch ? (
                      <span className="block text-xs">Batch {item.batch}</span>
                    ) : null}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{item.quantity}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatInr(item.unit_price_paise)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatInr(item.amount_paise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        <dl className="mt-4 space-y-1.5 border-t border-black pt-3 text-sm">
          {items.length ? (
            <div className="flex justify-between">
              <dt>Medicines</dt>
              <dd className="tabular-nums">{formatInr(receipt.medicines_paise)}</dd>
            </div>
          ) : null}
          {/* Only shown when the fee was actually taken at this counter. */}
          {Number(receipt.consultation_paise) > 0 ? (
            <div className="flex justify-between">
              <dt>Consultation fee{receipt.doctor_name ? ` · ${receipt.doctor_name}` : ""}</dt>
              <dd className="tabular-nums">{formatInr(receipt.consultation_paise)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-black pt-2 text-base font-bold">
            <dt>Total paid</dt>
            <dd className="tabular-nums">{formatInr(total)}</dd>
          </div>
          {receipt.payment_mode ? (
            <div className="flex justify-between text-xs">
              <dt>Payment mode</dt>
              <dd>{MODE_LABELS[receipt.payment_mode] ?? receipt.payment_mode}</dd>
            </div>
          ) : null}
        </dl>

        {/* Nothing is charged for these -- the hospital never gave them. They
            are named on the receipt so the family leaves knowing exactly what
            is still to be bought, and the slip beside it is what they hand to
            an outside chemist. */}
        {unsupplied.length ? (
          <section className="mt-5 border border-dashed border-black p-3">
            <p className="text-sm font-semibold uppercase">
              Not supplied · purchase outside
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {unsupplied.map((item, index) => (
                <li key={`${item.name}-${index}`}>
                  <span className="font-medium">{item.name}</span>
                  <span className="tabular-nums"> · {item.pending}</span>
                  {item.dose || item.frequency || item.duration ? (
                    <span className="block text-xs">
                      {[item.dose, item.frequency, item.duration]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs">
              Not charged on this receipt.
            </p>
          </section>
        ) : null}

        <p className="mt-6 border-t border-dashed border-black pt-3 text-xs">
          Received with thanks.
          {receipt.dispensed_by ? ` · Billed by ${receipt.dispensed_by}` : ""}
        </p>
      </article>
    </main>
  );
}
