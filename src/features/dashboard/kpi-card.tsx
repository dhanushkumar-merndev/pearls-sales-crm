"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type DetailRow = {
  primary_text: string;
  secondary_text: string | null;
  trailing_text: string | null;
  href: string | null;
};

/**
 * Plain-language explanation of each KPI, shown above the drill-down list.
 * Written for hospital staff, not developers — it says what the number counts
 * and, where it matters, what it deliberately excludes.
 */
export const METRIC_HELP: Record<string, { what: string; note?: string }> = {
  patients_seen_today: {
    what: "How many different patients came to the hospital today.",
    note: "A patient seeing two doctors is counted once here, but produces two consultations.",
  },
  patients_today: {
    what: "Patients whose record was created today — first-time registrations only.",
    note: "A returning patient registered last month is not counted here.",
  },
  visits_today: { what: "Consultations booked today across all doctors. One patient seeing two doctors counts twice." },
  waiting: { what: "Patients who have a token but have not yet been seen by the doctor." },
  vitals_pending: { what: "Patients waiting for reception staff to record their vitals." },
  ready: { what: "Vitals recorded and waiting for the doctor to call them in." },
  completed: { what: "Consultations the doctor has finished today." },
  pending_prescriptions: {
    what: "Prescriptions waiting at the pharmacy counter.",
    note: "Prescribing never reduces stock — only an actual dispense does.",
  },
  dispensed_today: {
    what: "Prescription sales fulfilled by pharmacy today.",
  },
  low_stock: { what: "Medicine batches at or below their reorder level, but not yet empty." },
  out_of_stock: { what: "Active medicine batches with zero quantity left." },
  expiring_soon: { what: "Batches with stock remaining that expire within 30 days." },
  reports_ready: { what: "Uploaded reports ready for the doctor to review." },
  reports_pending: { what: "Tests ordered where the report has not arrived yet." },
  followups_due: { what: "Completed consultations with a follow-up that is now due." },
  collected_today_paise: {
    what: "All money collected today — OP consultations, procedure bills and pharmacy sales combined.",
  },
  op_collection_paise: { what: "Consultation fees collected today at reception and the pharmacy counter." },
  pharmacy_sales_today_paise: { what: "Value of prescriptions dispensed today." },
};

export function KpiCard({
  metricKey,
  label,
  value,
  isMoney,
  icon,
}: {
  metricKey: string;
  label: string;
  value: string;
  isMoney: boolean;
  icon: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<DetailRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const help = METRIC_HELP[metricKey];

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const controller = new AbortController();
    // Kicked off in a microtask so the effect body itself does not setState
    // synchronously, which would cause a cascading render.
    const run = Promise.resolve().then(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
    });
    void run;
    fetch(`/api/dashboard/metric?metric=${encodeURIComponent(metricKey)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) setError(body.error ?? "Detail unavailable");
        else setRows(body.items ?? []);
      })
      .catch(() => {
        if (!cancelled && !controller.signal.aborted)
          setError("Detail could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [open, metricKey]);

  return (
    <>
      <Card
        role="button"
        tabIndex={0}
        aria-label={`${label}: ${value}. Open details`}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="cursor-pointer transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <CardContent className="flex items-center justify-between gap-2 p-2.5 md:p-3">
          <div className="min-w-0">
            <p className="text-[11px] leading-4 font-medium text-muted-foreground md:text-xs">{label}</p>
            <p
              className={
                isMoney
                  ? "mt-0.5 text-base leading-tight font-semibold tabular-nums break-words md:text-lg"
                  : "mt-0.5 truncate text-xl font-semibold tabular-nums md:text-2xl"
              }
              title={value}
            >
              {value}
            </p>
          </div>
          <span className="flex size-7.5 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground md:size-8.5">
            {icon}
          </span>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {label}: {value}
            </DialogTitle>
            <DialogDescription>{help?.what ?? "Details behind this number."}</DialogDescription>
          </DialogHeader>

          {help?.note ? (
            <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">{help.note}</p>
          ) : null}

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" /> Loading details
            </div>
          ) : error ? (
            <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
          ) : rows.length ? (
            <ul className="divide-y rounded-md border">
              {rows.map((row, index) => {
                const content = (
                  <div className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{row.primary_text}</p>
                      {row.secondary_text ? (
                        <p className="truncate text-xs text-muted-foreground">{row.secondary_text}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {row.trailing_text ? (
                        <span className="text-xs capitalize tabular-nums text-muted-foreground">
                          {isMoney ? `₹${row.trailing_text}` : row.trailing_text}
                        </span>
                      ) : null}
                      {row.href ? <ArrowRight className="size-3.5 text-muted-foreground" /> : null}
                    </div>
                  </div>
                );
                return (
                  <li key={`${row.primary_text}-${index}`} className="hover:bg-accent/40">
                    {row.href ? (
                      <Link href={row.href} onClick={() => setOpen(false)} className="block">
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nothing to show for this metric right now.
            </p>
          )}

          {rows.length >= 25 ? (
            <p className="text-xs text-muted-foreground">Showing the first 25. Open the module for the full list.</p>
          ) : null}

          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </>
  );
}
