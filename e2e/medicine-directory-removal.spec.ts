import { expect, test } from "@playwright/test";
import { credentialsConfigured, missingCredentials, signIn } from "./support/auth";

/**
 * The medicine library as an admin reaches it, and the removal that does not
 * touch hospital history.
 *
 * What the browser can prove here is the unused half of the removal: a
 * medicine created and removed inside the test leaves nothing behind, so the
 * spec adds no residue to the database it runs against. The archiving half --
 * a medicine a prescription, sale or ledger row still points at -- is pinned
 * in supabase/tests/medicine_directory_removal.test.sql, where the fixtures
 * roll back.
 */
test.skip(!credentialsConfigured, missingCredentials);

const uniqueName = () => `ZZ E2E Removal ${Date.now()}`;

test("admin reaches the medicine library from Administration", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Sidebar grouping is checked once.");
  await signIn(page, "admin");
  const administration = page
    .locator("[data-slot=sidebar-group]")
    .filter({ hasText: "Administration" });
  const link = administration.getByRole("link", { name: "Medicine Directory" });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/pharmacy\/medicines/);
  await expect(page.locator("h1:visible").first()).toHaveText("Medicine Master");
});

test("an unused medicine can be deleted and leaves nothing behind", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One removal round trip is enough.");
  test.setTimeout(120_000);
  const name = uniqueName();
  await signIn(page, "admin");
  await page.goto("/pharmacy/medicines");

  await page.getByRole("button", { name: "Add Medicine" }).click();
  await page.getByLabel("Medicine name").fill(name);
  await page.getByLabel("Dosage form", { exact: true }).fill("Tablet");
  await page.getByRole("button", { name: "Save Medicine" }).click();
  await expect(page.getByText("Medicine saved.")).toBeVisible();

  const search = page.getByLabel("Search medicine master");
  await search.fill(name);
  const row = page.getByRole("row", { name: new RegExp(name) });
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(
    page.getByText(/Every past prescription, sale, bill and stock ledger entry/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove medicine" }).click();

  // Never prescribed, sold or stocked, so there is nothing to preserve and the
  // row is really deleted rather than archived.
  await expect(page.getByText(/It was never used/)).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(name) })).toHaveCount(0);

  await page.getByRole("button", { name: "Removed" }).click();
  await expect(page.locator("h1:visible").first()).toHaveText("Removed Medicines");
  await page.getByLabel("Search removed medicines").fill(name);
  await expect(page.getByRole("row", { name: new RegExp(name) })).toHaveCount(0);
});

test("pharmacy is not offered the removal controls", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Control visibility is not viewport dependent.");
  await signIn(page, "pharmacy");
  await page.goto("/pharmacy/medicines");
  await expect(page.locator("h1:visible").first()).toHaveText("Medicine Master");
  await expect(page.getByRole("button", { name: "Removed" })).toHaveCount(0);
  // The database refuses a pharmacy removal outright (delete_medicine is admin
  // only); this checks the screen does not offer it either.
  await page.goto("/pharmacy/medicines?view=removed");
  await expect(page.locator("h1:visible").first()).toHaveText("Medicine Master");
});
