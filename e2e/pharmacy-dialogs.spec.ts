import { expect, test } from "@playwright/test";
import { credentialsConfigured, missingCredentials, signIn } from "./support/auth";

test.skip(!credentialsConfigured, missingCredentials);

test("dosage form can be typed or picked from previously used values", async ({ page }) => {
  await signIn(page, "pharmacy");
  await page.goto("/pharmacy/medicines");
  await page.getByRole("button", { name: "Add Medicine" }).click();
  // exact: once the suggestion list is open, its own aria-label
  // ("Dosage form suggestions") also matches a substring search.
  const dosageForm = page.getByLabel("Dosage form", { exact: true });
  await dosageForm.click();
  const list = page.getByRole("listbox", { name: /Dosage form suggestions/i });
  await expect(list).toBeVisible();
  // Typed first, then picked. The list shows the first eight suggestions in
  // alphabetical order, and the directory has learned enough dosage forms
  // that "Tablet" no longer sits inside an unfiltered list.
  // exact: a name option is a case-insensitive SUBSTRING match by default, so
  // a plain "Tablet" would also hit "CHEWABLE TABLET" and an all-caps "TABLET".
  await dosageForm.fill("Tab");
  await expect(list.getByRole("option", { name: "Tablet", exact: true })).toBeVisible();
  await dosageForm.fill("Tab");
  await list.getByRole("option", { name: "Tablet", exact: true }).click();
  await expect(dosageForm).toHaveValue("Tablet");
  // A value nobody has used yet stays typed -- the list is a suggestion, not
  // a constraint, and the save is what teaches it.
  await dosageForm.fill("Medicated Shampoo");
  await expect(dosageForm).toHaveValue("Medicated Shampoo");
});

test("a new batch asks for the number of packs before the pack size", async ({ page }) => {
  await signIn(page, "pharmacy");
  await page.goto("/pharmacy/stock");
  await page.getByRole("button", { name: "Add Batch" }).first().click();
  const labels = await page.locator("dialog label, [role=dialog] label").allInnerTexts();
  const packs = labels.findIndex((t) => /number of packs/i.test(t));
  const size = labels.findIndex((t) => /units per pack/i.test(t));
  expect(packs, "Number of packs is present").toBeGreaterThanOrEqual(0);
  expect(size, "Units per pack is present").toBeGreaterThanOrEqual(0);
  expect(packs).toBeLessThan(size);
});
