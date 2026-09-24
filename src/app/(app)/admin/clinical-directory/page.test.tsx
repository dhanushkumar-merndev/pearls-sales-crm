import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const longDisplayText = "Chronic shoulder pain with restricted movement";

vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/lib/auth/dal", () => ({ requireRoute: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: () => {
      const query = {
        select: () => query,
        order: () => query,
        range: () => Promise.resolve({
          count: 1,
          data: [{
            id: "term-1",
            term_type: "diagnosis",
            display_text: longDisplayText,
            search_aliases: [],
            active: true,
            source: "Pain Clinic",
            code: null,
            code_system: null,
          }],
        }),
      };
      return query;
    },
  }),
}));
vi.mock("@/components/shared/page-header", () => ({
  PageHeader: ({ title, actions }: { title: string; actions: React.ReactNode }) => <header><h1>{title}</h1>{actions}</header>,
}));
vi.mock("@/components/shared/status-badge", () => ({ StatusBadge: ({ status }: { status: string }) => <span>{status}</span> }));
vi.mock("@/features/admin/master-dialogs", () => ({ ClinicalTermDialog: () => <button>Edit</button> }));
vi.mock("@/components/shared/debounced-search-input", () => ({ DebouncedSearchInput: () => <input aria-label="Search clinical directory" /> }));
vi.mock("@/components/shared/table-pagination", () => ({
  PAGE_SIZE: 25,
  TablePagination: () => null,
  pageFromParam: () => 1,
  rangeFor: () => [0, 24],
}));
vi.mock("@/components/ui/button", () => ({ Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button> }));
vi.mock("@/components/ui/card", () => ({ Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render: element }: { render: React.ReactNode }) => <>{element}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/ui/table", () => ({
  Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableCell: ({ children }: { children: React.ReactNode }) => <td>{children}</td>,
  TableHead: ({ children }: { children: React.ReactNode }) => <th>{children}</th>,
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableRow: ({ children }: { children: React.ReactNode }) => <tr>{children}</tr>,
}));

import ClinicalDirectoryPage from "./page";

describe("ClinicalDirectoryPage", () => {
  it("truncates long display text and retains the full Pain Clinic term in a tooltip", async () => {
    render(await ClinicalDirectoryPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText(`${longDisplayText.slice(0, 20)}…`)).toBeInTheDocument();
    expect(screen.getByText(longDisplayText)).toBeInTheDocument();
  });
});
