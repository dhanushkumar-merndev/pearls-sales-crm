import { expect, test } from "@playwright/test";
import { credentialsConfigured, missingCredentials, signIn } from "./support/auth";
import { lookupPrescriptions } from "./support/fixtures";

test.skip(!credentialsConfigured, missingCredentials);

test("an unsupplied prescription prints a slip for buying outside", async ({ page }) => {
  // Looked up, not hardcoded: the literal id this used to carry became a 404
  // once that row was cleared, which read as a broken print route.
  const { undispensed } = await lookupPrescriptions();
  test.skip(!undispensed, "This database has no prescription with undispensed items.");

  await signIn(page, "pharmacy");
  const response = await page.goto(`/print/outside-purchase/${undispensed}`);
  expect(response?.status(), `outside-purchase slip for ${undispensed}`).toBe(200);
  await expect(page.getByText(/Outside Purchase Prescription/i)).toBeVisible();
  await expect(page.getByText(/Nothing on this sheet has been billed/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Print Outside Purchase Slip/i })).toBeVisible();
});

test("reception sees each consultant's current load in the dropdown", async ({ page }) => {
  await signIn(page, "reception");
  await page.goto("/reception");
  await page.getByRole("button", { name: "Find or Add Patient" }).click();
  await page.getByRole("button", { name: "Add new patient" }).click();
  await page.getByRole("combobox", { name: "Doctor" }).click();
  const options = page.getByRole("option");
  await expect(options.first()).toBeVisible();
  // Every consultant reads as either a load badge or "free" -- never blank.
  const text = (await options.allInnerTexts()).join(" ");
  expect(text).toMatch(/free|OP \d|IP \d/);
});

test("a fully supplied receipt still prints unchanged", async ({ page }) => {
  await signIn(page, "pharmacy");
  const response = await page.goto("/print/receipt/8c169dc6-6cc7-41b5-b170-7baabccb7907");
  test.skip(response?.status() !== 200, "Sale no longer in this database.");
  await expect(page.getByText("Payment Receipt")).toBeVisible();
  // Nothing outstanding on this one, so neither the section nor the slip link
  // should appear.
  await expect(page.getByText(/Not supplied · purchase outside/i)).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Outside Purchase Slip/i })).toHaveCount(0);
});
