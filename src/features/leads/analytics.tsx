import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type LeadReport = {
  total: number; converted: number; booked_or_converted: number; lost: number;
  unassigned: number; median_hours_to_first_contact: number | null;
  by_source: { source: string; leads: number; converted: number }[];
  by_campaign: { campaign: string; leads: number; converted: number }[];
  by_owner: { owner: string; leads: number; contacted: number; booked: number; converted: number; lost: number }[];
};

export function LeadAnalytics({ report }: { report: LeadReport }) {
  const metrics = [
    ["Enquiries received", report.total], ["Booked or converted", report.booked_or_converted],
    ["Converted to visits", report.converted], ["Lost", report.lost],
    ["Unassigned", report.unassigned],
    ["Median hours to first contact", report.median_hours_to_first_contact ?? "—"],
  ] as const;
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">Current outcomes for enquiries received in the selected date range. Conversion means reception has created a visit.</p>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{metrics.map(([label, value]) => <Card key={label}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p></CardContent></Card>)}</div>
    <Card><CardHeader><CardTitle className="text-base">Sales executive outcomes</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow>{["Sales executive", "Enquiries", "Contacted", "Booked or converted", "Converted", "Lost"].map((label) => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{report.by_owner.map((row, index) => <TableRow key={index}><TableCell>{row.owner}</TableCell><TableCell>{row.leads}</TableCell><TableCell>{row.contacted}</TableCell><TableCell>{row.booked}</TableCell><TableCell>{row.converted}</TableCell><TableCell>{row.lost}</TableCell></TableRow>)}{!report.by_owner.length ? <TableRow><TableCell colSpan={6} className="h-20 text-center text-muted-foreground">No enquiries in this range.</TableCell></TableRow> : null}</TableBody></Table></CardContent></Card>
    <div className="grid items-start gap-4 lg:grid-cols-2">{[
      { title: "Lead sources", rows: report.by_source.map((row) => ({ label: row.source, ...row })) },
      { title: "Top campaigns", rows: report.by_campaign.map((row) => ({ label: row.campaign, ...row })) },
    ].map(({ title, rows }) => <Card key={title}><CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Enquiries</TableHead><TableHead>Converted</TableHead></TableRow></TableHeader><TableBody>{rows.map((row, index) => <TableRow key={index}><TableCell>{row.label}</TableCell><TableCell>{row.leads}</TableCell><TableCell>{row.converted}</TableCell></TableRow>)}{!rows.length ? <TableRow><TableCell colSpan={3} className="h-20 text-center text-muted-foreground">No data in this range.</TableCell></TableRow> : null}</TableBody></Table></CardContent></Card>)}</div>
  </div>;
}
