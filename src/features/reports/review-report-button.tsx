"use client";

import { useActionState } from "react";
import { CheckCheck, ExternalLink, LoaderCircle } from "lucide-react";
import { reviewReport } from "./actions";
import { Button } from "@/components/ui/button";

export function ReviewReportButton({ reportId, reviewed = false }: { reportId: string; reviewed?: boolean }) {
  const [state, action, pending] = useActionState(reviewReport, { ok: false });
  return <div className="flex justify-end gap-1"><Button size="sm" variant="outline" render={<a href={`/api/reports/${reportId}`} target="_blank" rel="noreferrer" />}><ExternalLink /> Open</Button>{reviewed || state.ok ? <Button size="sm" variant="ghost" disabled><CheckCheck /> Reviewed</Button> : <form action={action}><input type="hidden" name="reportId" value={reportId} /><Button size="sm" disabled={pending} type="submit">{pending ? <LoaderCircle className="animate-spin" /> : <CheckCheck />} Mark Reviewed</Button></form>}</div>;
}
