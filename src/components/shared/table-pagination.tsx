import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Rows per page for admin list tables. */
export const PAGE_SIZE = 25;

/** Reads a `?page=` value, clamping anything nonsensical back to the first page. */
export function pageFromParam(value: string | undefined) {
  return Math.max(1, Number(value) || 1);
}

/** Zero-based offset range for a Supabase `.range()` call. */
export function rangeFor(page: number, size = PAGE_SIZE) {
  const from = (page - 1) * size;
  return [from, from + size - 1] as const;
}

/**
 * Previous/Next for a server-rendered table.
 *
 * Every admin list needs this and several of them did not have it: a table
 * capped at the first 100 rows with no controls does not look truncated, it
 * looks complete, so the rows past the cap are not merely awkward to reach --
 * there is no way to know they exist. Showing the total is part of the fix.
 *
 * Offset paging is deliberate: these are reference tables read by one admin at
 * a time, where jumping pages matters more than the constant-time seek a
 * keyset cursor would give. A table heading for the high tens of thousands
 * (the clinical directory, after a full terminology import) should move to
 * keyset ordering on (name, id) instead.
 */
export function TablePagination({
  page,
  total,
  noun,
  params,
  size = PAGE_SIZE,
}: {
  page: number;
  total: number;
  /** Plural noun for the count, e.g. "clinical terms". */
  noun: string;
  /** Other query parameters to preserve, such as the search text or tab. */
  params?: Record<string, string | number | undefined | null>;
  size?: number;
}) {
  const pageCount = Math.max(1, Math.ceil(total / size));
  const href = (next: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params ?? {}))
      if (value !== undefined && value !== null && value !== "")
        search.set(key, String(value));
    if (next > 1) search.set("page", String(next));
    const query = search.toString();
    return query ? `?${query}` : "?";
  };
  const first = total === 0 ? 0 : (page - 1) * size + 1;
  const last = Math.min(page * size, total);
  return (
    // A nav landmark, named for the table it pages: "Next" on its own is not a
    // unique accessible name on a page (in dev, Next.js's own toolbar button is
    // called "Open Next.js Dev Tools"), and a screen reader listing landmarks
    // should hear which table each pager belongs to.
    <nav
      aria-label={`${noun} pagination`}
      className="flex flex-wrap items-center justify-between gap-2 border-t p-3 text-sm text-muted-foreground"
    >
      <span className="tabular-nums">
        {total === 0
          ? `No ${noun}`
          : `${first}–${last} of ${total} ${noun}`}
      </span>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={page <= 1}
          render={page > 1 ? <Link href={href(page - 1)} /> : undefined}
        >
          Previous
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={page >= pageCount}
          render={page < pageCount ? <Link href={href(page + 1)} /> : undefined}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}
