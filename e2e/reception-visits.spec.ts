import { expect, test } from "@playwright/test";
import { credentialsConfigured, missingCredentials, signIn } from "./support/auth";

/**
 * Reception's Today's Visits lists the newest registration first, so the visit
 * just created is the top row rather than buried under the day's history.
 */
test.describe("reception today's visits", () => {
  test.skip(!credentialsConfigured, missingCredentials);

  test("a newly created visit appears in the first row", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Runs once, on desktop.");
    test.setTimeout(180_000);
    const stamp = Date.now().toString().slice(-9);
    const patientName = `Newest First ${stamp.slice(-4)}`;

    await signIn(page, "reception");
    await page.goto("/reception");
    await page.getByRole("button", { name: "Find or Add Patient" }).click();
    await page.getByPlaceholder("UHID, mobile number or patient name").fill(`9${stamp}`);
    await page.getByRole("button", { name: "Add new patient" }).click();
    await page.getByLabel("Patient name *").fill(patientName);
    await page.getByLabel("Mobile number *").fill(`9${stamp}`);
    // A first-time patient is registered and given their token in one submit.
    await page.getByRole("button", { name: "Register & Create Visit" }).click();
    await expect(page.getByRole("heading", { name: "Visit created" })).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("Escape");

    await page.reload();
    await expect(page.locator("tbody tr").first()).toContainText(patientName);
  });
});
