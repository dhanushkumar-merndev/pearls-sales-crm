import Link from "next/link";
import { Button } from "@/components/ui/button";

export function TablePager({ page, pages, total, params = {} }: { page: number; pages: number; total: number; params?: Record<string, string | undefined> }) {
  const href = (next: number) => { const search = new URLSearchParams(); for (const [key, value] of Object.entries(params)) if (value) search.set(key, value); search.set("page", String(next)); return `?${search}`; };
  // On a phone the record count and the three controls fought for one row, so
  // "100,063 records" wrapped onto two lines and squeezed the buttons. The
  // controls take the top row on their own and the count sits underneath;
  // from sm: up it goes back to a single row with the count on the left.
  return (
    <div className="flex flex-col-reverse gap-2 border-t p-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <span className="text-center sm:text-left">
        {total.toLocaleString("en-IN")} records
      </span>
      <div className="flex items-center justify-center gap-2 sm:justify-end">
        <Button size="sm" variant="outline" disabled={page <= 1} render={page > 1 ? <Link href={href(page - 1)} /> : undefined}>Previous</Button>
        <span className="px-1 whitespace-nowrap">{page} / {pages}</span>
        <Button size="sm" variant="outline" disabled={page >= pages} render={page < pages ? <Link href={href(page + 1)} /> : undefined}>Next</Button>
      </div>
    </div>
  );
}
