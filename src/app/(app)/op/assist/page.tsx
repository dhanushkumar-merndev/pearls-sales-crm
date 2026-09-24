import Link from "next/link";
import { requireRoute } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatHospitalDate } from "@/lib/domain/date";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { DebouncedSearchInput } from "@/components/shared/debounced-search-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Row = {
  id: string;
  token_number: number;
  status: string;
  created_at: string;
  patients: { name: string; uhid: string; phone_normalized: string } | null;
  doctors: { display_name: string } | null;
  // consultations.visit_id and prescriptions.visit_id are both unique, so
  // PostgREST embeds a single object (or null), never an array.
  consultations: { status: string } | null;
  prescriptions: { status: string } | null;
};

/**
 * Screen for reception staff who guide consulted patients to the next counter.
 *
 * Deliberately shows no amounts. The assistant carries the prescription to the
 * pharmacy and guides the patient; billing is done by reception or pharmacy, so
 * The merged reception account already has a dedicated Fees & Payments page,
 * so this operational queue stays focused on the patient's next stop.
 */
export default async function OpAssistPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireRoute("/op");
  const q = (await searchParams).q?.trim() ?? "";
  const supabase = await createSupabaseServerClient();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

  const { data } = await supabase
    .from("visits")
    .select(
      "id,token_number,status,created_at,patients(name,uhid,phone_normalized),doctors(display_name),consultations(status),prescriptions(status)",
    )
    .eq("visit_date", today)
    .order("token_number");

  let rows = (data ?? []) as unknown as Row[];
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter(
      (row) =>
        row.patients?.name.toLowerCase().includes(needle) ||
        row.patients?.phone_normalized.includes(needle) ||
        row.patients?.uhid.toLowerCase().includes(needle) ||
        String(row.token_number) === needle.replace("#", ""),
    );
  }

  /** Where this patient goes next, from the state of their consultation. */
  function nextStop(row: Row) {
    const consultation = row.consultations;
    if (row.status !== "completed" || consultation?.status !== "completed")
      return { label: "With doctor", tone: "secondary" as const };
    const rx = row.prescriptions;
    if (rx && ["pending", "partially_dispensed"].includes(rx.status))
      return { label: "Pharmacy", tone: "default" as const };
    return { label: "Billing counter", tone: "default" as const };
  }

  const waiting = rows.filter((r) => r.status !== "completed").length;
  const toGuide = rows.filter((r) => r.status === "completed").length;

  return (
    <div>
      <PageHeader
        title="Patient Assist"
        description="Today's patients and where each one goes next. Amounts are handled at the billing and pharmacy counters."
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Still with doctor</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{waiting}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Ready to guide</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{toGuide}</p>
          </CardContent>
        </Card>
      </div>
      <DebouncedSearchInput
        className="mb-4 max-w-md"
        initialValue={q}
        placeholder="Search token, UHID, name or phone"
        ariaLabel="Search today's patients"
      />
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Token</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Doctor</TableHead>
                  <TableHead>Consultation</TableHead>
                  <TableHead>Send To</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length ? (
                  rows.map((row) => {
                    const stop = nextStop(row);
                    const consultationDone = row.consultations?.status === "completed";
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium tabular-nums">#{row.token_number}</TableCell>
                        <TableCell>
                          <span className="font-medium">{row.patients?.name ?? "—"}</span>
                          <span className="block text-xs text-muted-foreground">
                            {row.patients?.uhid} · {row.patients?.phone_normalized}
                          </span>
                        </TableCell>
                        <TableCell>{row.doctors?.display_name ?? "—"}</TableCell>
                        <TableCell>
                          <StatusBadge status={consultationDone ? "completed" : row.status} />
                        </TableCell>
                        <TableCell>
                          <Badge variant={stop.tone}>{stop.label}</Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatHospitalDate(row.created_at, true)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" render={<Link href={`/visits/${row.id}`} />}>
                            Open
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                      {q ? "No patient matches this search." : "No patients registered today yet."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
