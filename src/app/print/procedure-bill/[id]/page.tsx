import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatInr } from "@/lib/domain/money";
import { PrintButton } from "@/components/shared/print-button";
import { HospitalLetterhead } from "@/components/shared/hospital-letterhead";
import { getHospitalIdentity } from "@/lib/print/hospital-identity.server";

type Receipt = {
  sale_id: string;
  sale_number: number;
  created_at: string;
  procedure_name: string;
  procedure_fee_paise: number;
  items_total_paise: number;
  total_paise: number;
  payment_mode: string;
  patient_name: string | null;
  patient_phone: string | null;
  patient_uhid: string | null;
  doctor_name: string | null;
  billed_by: string | null;
  items: Array<{
    name: string;
    quantity: number;
    unit_price_paise: number;
    amount_paise: number;
  }>;
};

const MODE_LABELS: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  bank_transfer: "Bank Transfer",
  other: "Other",
};

/** Counter receipt for one procedure bill -- dressings, suturing and the
 * inventory items consumed with them. Reachable both right after billing
 * and later from the Procedure Bills list, so a bill is never a one-shot
 * event that can't be reprinted. */
export default async function ProcedureBillReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_procedure_bill_receipt", { p_sale_id: id });
  const receipt = (Array.isArray(data) ? data[0] : data) as Receipt | undefined;
  if (error || !receipt) notFound();

  const identity = await getHospitalIdentity();
  const at = new Date(receipt.created_at);
  const items = receipt.items ?? [];

  return (
    <main className="mx-auto min-h-screen max-w-[210mm] bg-white p-4 text-black sm:p-8">
      <div data-print-hidden className="mb-4 flex justify-end">
        <PrintButton label="Print Bill" />
      </div>
      <article className="border border-black/20 p-7 font-sans print:border-0 print:p-0">
        <HospitalLetterhead identity={identity} logoSize={48} />
        <p className="mt-4 border-y border-black py-2 text-center text-sm font-semibold uppercase">
          Procedure Bill
        </p>

        <dl className="mt-4 grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
          <dt className="font-semibold">Bill No</dt>
          <dd className="font-mono">
            PR-{String(receipt.sale_number).padStart(6, "0")}
          </dd>
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
          <dt className="font-semibold">Procedure</dt>
          <dd>{receipt.procedure_name}</dd>
        </dl>

        {items.length ? (
          <table className="mt-5 w-full border-collapse text-sm">
            <thead>
              <tr className="border-y border-black text-left">
                <th className="py-1.5 font-semibold">Item</th>
                <th className="py-1.5 text-right font-semibold">Qty</th>
                <th className="py-1.5 text-right font-semibold">Rate</th>
                <th className="py-1.5 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr className="border-b border-black/20" key={`${item.name}-${index}`}>
                  <td className="py-1.5 pr-2">{item.name}</td>
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
          <div className="flex justify-between">
            <dt>Procedure fee</dt>
            <dd className="tabular-nums">{formatInr(receipt.procedure_fee_paise)}</dd>
          </div>
          {items.length ? (
            <div className="flex justify-between">
              <dt>Items</dt>
              <dd className="tabular-nums">{formatInr(receipt.items_total_paise)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-black pt-2 text-base font-bold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatInr(receipt.total_paise)}</dd>
          </div>
          <div className="flex justify-between text-xs">
            <dt>Payment mode</dt>
            <dd>
              {MODE_LABELS[receipt.payment_mode] ?? receipt.payment_mode}
            </dd>
          </div>
        </dl>

        <p className="mt-6 border-t border-dashed border-black pt-3 text-xs">
          Received with thanks.
          {receipt.billed_by ? ` · Billed by ${receipt.billed_by}` : ""}
        </p>
      </article>
    </main>
  );
}
