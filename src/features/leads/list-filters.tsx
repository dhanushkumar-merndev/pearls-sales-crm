"use client";
import { useRouter } from "next/navigation";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { LEAD_STATUSES, type Owner } from "./schema";
export function LeadFilters({ status, source, owner, owners, showStatus, isAdmin }: { status?: string; source?: string; owner?: string; owners: Owner[]; showStatus: boolean; isAdmin: boolean }) {
  const router = useRouter();
  const filter = (name: string, label: string, value: string | undefined, options: { value: string; label: string }[]) => <Select value={value || "all"} onValueChange={(next) => { const params = new URLSearchParams(window.location.search); if (!next || next === "all") params.delete(name); else params.set(name, next); params.delete("page"); router.push(`${window.location.pathname}?${params}`); }}><SelectTrigger aria-label={label} className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{label}</SelectItem>{options.map((o) => <SelectItem key={o.value} value={o.value} label={o.label}>{o.label}</SelectItem>)}</SelectContent></Select>;
  return <>{showStatus ? filter("status", "All statuses", status, LEAD_STATUSES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))) : null}{filter("source", "All sources", source, [{ value: "meta", label: "Meta" }, { value: "manual", label: "Manual" }])}{isAdmin ? filter("owner", "All executives", owner, [{ value: "unassigned", label: "Unassigned" }, ...owners.map((o) => ({ value: o.id, label: o.full_name }))]) : null}</>;
}
