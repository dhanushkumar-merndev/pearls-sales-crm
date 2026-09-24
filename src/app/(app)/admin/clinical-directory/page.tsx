import Link from "next/link";
import { requireRoute } from "@/lib/auth/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FileSpreadsheet } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ClinicalTermDialog } from "@/features/admin/master-dialogs";
import { DebouncedSearchInput } from "@/components/shared/debounced-search-input";
import { PAGE_SIZE, TablePagination, pageFromParam, rangeFor } from "@/components/shared/table-pagination";
import { containsSearchPattern } from "@/lib/domain/search";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function SearchAliases({ aliases }: { aliases: string[] }) {
  const fullAliases = aliases.join(", ");
  if (!fullAliases) return "—";
  if (fullAliases.length <= 20) return fullAliases;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="block max-w-40 cursor-help truncate" tabIndex={0}>
            {fullAliases.slice(0, 20)}…
          </span>
        }
      />
      <TooltipContent className="max-w-sm break-words">{fullAliases}</TooltipContent>
    </Tooltip>
  );
}

function DisplayText({ text }: { text: string }) {
  if (text.length <= 20) return text;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="block max-w-40 cursor-help truncate" tabIndex={0}>
            {text.slice(0, 20)}…
          </span>
        }
      />
      <TooltipContent className="max-w-sm break-words">{text}</TooltipContent>
    </Tooltip>
  );
}

export default async function ClinicalDirectoryPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await requireRoute("/admin/clinical-directory");
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const page = pageFromParam(params.page);
  const supabase = await createSupabaseServerClient();
  // This table is the target of the ICD-10 / SNOMED bulk import, so it is the
  // one master that genuinely reaches five figures. It used to be capped at
  // the first hundred rows with no way to reach the rest.
  let query = supabase
    .from("clinical_terms")
    .select("id,term_type,display_text,search_aliases,active,source,code,code_system", { count: "exact" })
    .order("term_type")
    .order("display_text")
    .range(...rangeFor(page));
  // Code and code_system are searchable too -- "SNOMED" or "J45" finds a
  // coded term the same way a display-text search does.
  if (q) { const pattern = containsSearchPattern(q); query = query.or(`display_text.ilike.${pattern},term_type.ilike.${pattern},source.ilike.${pattern},code.ilike.${pattern},code_system.ilike.${pattern}`); }
  const { data, count } = await query;
  const rows = data ?? [];
  const total = count ?? 0;
  return (
    <div>
      <PageHeader
        title="Clinical Directory"
        description="Local offline-ready terminology for doctor autocomplete"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" render={<Link href="/admin/clinical-directory/import" />}>
              <FileSpreadsheet /> Bulk Import
            </Button>
            <ClinicalTermDialog />
          </div>
        }
      />
      <DebouncedSearchInput className="mb-4 max-w-md" initialValue={q} placeholder="Search clinical term, type or source" ariaLabel="Search clinical directory" />
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Display Text</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Code System</TableHead>
                <TableHead>Search Aliases</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((term) => (
                <TableRow key={term.id}>
                  <TableCell className="capitalize">{term.term_type}</TableCell>
                  <TableCell className="font-medium">
                    <DisplayText text={term.display_text} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{term.code || "—"}</TableCell>
                  <TableCell>{term.code_system || "—"}</TableCell>
                  <TableCell><SearchAliases aliases={term.search_aliases} /></TableCell>
                  <TableCell>
                    <StatusBadge status={term.active ? "active" : "inactive"} />
                  </TableCell>
                  <TableCell>{term.source}</TableCell>
                  <TableCell>
                    <ClinicalTermDialog item={{ id: term.id, type: term.term_type, displayText: term.display_text, aliases: term.search_aliases.join(", "), source: term.source, code: term.code, codeSystem: term.code_system, active: term.active }} />
                  </TableCell>
                </TableRow>
              ))}
              {!rows.length ? <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">{q ? "No clinical terms match this search." : "No clinical terms found."}</TableCell></TableRow> : null}
            </TableBody>
          </Table>
          </div>
          <TablePagination page={page} total={total} noun="clinical terms" params={{ q }} size={PAGE_SIZE} />
        </CardContent>
      </Card>
    </div>
  );
}
