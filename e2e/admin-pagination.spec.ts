import { expect, test, type Page } from "@playwright/test";
import { credentialsConfigured, missingCredentials, signIn } from "./support/auth";

/**
 * Every admin list reaches every row.
 *
 * Several of these tables used to render the first 100 rows (or, worse, every
 * row the API would hand back) with no controls and no total. A truncated
 * table with no footer does not look truncated -- it looks complete -- so the
 * rows past the cap were not merely awkward to reach, there was no way to know
 * they existed. The footer showing "26-50 of 2525" is the fix as much as the
 * Next button is.
 */
test.skip(!credentialsConfigured, missingCredentials);

const LISTS = [
  { path: "/admin/clinical-directory", noun: "clinical terms" },
  { path: "/admin/masters?tab=departments", noun: "departments" },
  { path: "/admin/masters?tab=charges", noun: "charges" },
  { path: "/admin/masters?tab=report-categories", noun: "report categories" },
  { path: "/admin/doctors", noun: "doctors" },
  { path: "/admin/users", noun: "staff users" },
  { path: "/pharmacy/medicines", noun: "medicines" },
  { path: "/admin/exports", noun: "exports" },
  { path: "/reception/payments?view=collected", noun: "payments" },
  { path: "/pharmacy?status=all", noun: "prescriptions" },
  { path: "/pharmacy/inventory", noun: "items" },
  { path: "/pharmacy/inventory?tab=bills", noun: "bills" },
];

/**
 * Reads the pagination footer, e.g. "26-50 of 2525 clinical terms".
 *
 * Parsed from the digits rather than matched with an anchored pattern: the
 * separator is an en dash, and the point of the assertion is the numbers.
 */
function pager(page: Page, noun: string) {
  // Scoped to this table's pagination landmark. An unscoped
  // getByRole("button", { name: "Next" }) also matches the Next.js dev
  // toolbar ("Open Next.js Dev Tools"), which is present in dev runs only --
  // so the suite passed headless CI and broke the moment it ran against the
  // dev server.
  return page.getByRole("navigation", { name: `${noun} pagination` });
}

async function readFooter(page: Page, noun: string) {
  const footer = pager(page, noun).getByText(new RegExp(`of \\d+ ${noun}|No ${noun}`));
  await expect(footer, `${noun} footer is present`).toBeVisible();
  const text = await footer.innerText();
  const match = text.match(/(\d+)\D+(\d+) of (\d+)/);
  return match
    ? { first: Number(match[1]), last: Number(match[2]), total: Number(match[3]) }
    : { first: 0, last: 0, total: 0 };
}

test("every admin list shows its total and can reach the next page", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Pagination is checked once, on desktop.");
  test.setTimeout(180_000);
  await signIn(page, "admin");

  for (const list of LISTS) {
    await page.goto(list.path);
    const first = await readFooter(page, list.noun);
    if (first.total === 0) continue;
    expect(first.first, `${list.path} starts at row 1`).toBe(1);

    const next = pager(page, list.noun).getByRole("button", { name: "Next" });
    if (first.total <= first.last) {
      // A single page: Next must be unavailable rather than leading nowhere.
      await expect(next, `${list.path} disables Next on a single page`).toBeDisabled();
      continue;
    }
    // Page links use a client-side navigation. Waiting for its URL makes the
    // assertion read the new server-rendered footer, rather than the still
    // visible first page while React is transitioning.
    await Promise.all([
      page.waitForURL(/(?:\?|&)page=2(?:&|$)/),
      next.click(),
    ]);
    const second = await readFooter(page, list.noun);
    expect(second.first, `${list.path} page 2 continues where page 1 stopped`).toBe(first.last + 1);
    expect(second.total, `${list.path} total is stable across pages`).toBe(first.total);
    await expect(pager(page, list.noun).getByRole("button", { name: "Previous" })).toBeEnabled();
  }
});

test("the clinical directory reaches rows far past the old 100-row cap", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runs once, on desktop.");
  test.setTimeout(120_000);
  await signIn(page, "admin");
  await page.goto("/admin/clinical-directory");
  const { total } = await readFooter(page, "clinical terms");
  test.skip(total <= 100, "This database has fewer than 100 clinical terms.");

  // Row 101 was unreachable before: no control led past the first page.
  const lastPage = Math.ceil(total / 25);
  await page.goto(`/admin/clinical-directory?page=${lastPage}`);
  const last = await readFooter(page, "clinical terms");
  expect(last.last).toBe(total);
  expect(last.first).toBeGreaterThan(100);
  await expect(pager(page, "clinical terms").getByRole("button", { name: "Next" })).toBeDisabled();
  // A header row plus real rows, not an empty page past the end.
  expect(await page.getByRole("row").count()).toBeGreaterThan(1);
});
