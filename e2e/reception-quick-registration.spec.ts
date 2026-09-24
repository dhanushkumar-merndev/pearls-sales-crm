import { expect, test } from "@playwright/test";
import { credentialsConfigured, missingCredentials, signIn } from "./support/auth";

/**
 * Registration stays two fields long so a queue keeps moving, but when there is
 * time the rest of the record can be captured in the same dialog instead of
 * being chased later from the pending row.
 */
test.describe("reception quick registration", () => {
  test.skip(!credentialsConfigured, missingCredentials);

  test("full details can be filled inline and are saved", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Runs once, on desktop.");
    test.setTimeout(240_000);
    const stamp = Date.now().toString().slice(-9);
    const patientName = `Full Detail ${stamp.slice(-4)}`;

    await signIn(page, "reception");
    await page.goto("/reception");
    await page.getByRole("button", { name: "Find or Add Patient" }).click();
    await page.getByPlaceholder("UHID, mobile number or patient name").fill(`9${stamp}`);
    await page.getByRole("button", { name: "Add new patient" }).click();
    await page.getByLabel("Patient name *").fill(patientName);
    await page.getByLabel("Mobile number *").fill(`9${stamp}`);

    // The extra fields stay out of the way until asked for.
    await expect(page.locator("#quick-gender")).toHaveCount(0);
    await page.getByText("Fill the full details now").click();
    await expect(page.locator("#quick-gender")).toBeVisible();

    await page.getByRole("button", { name: "Date of birth" }).click();
    await page.getByRole("gridcell").filter({ hasText: /^15$/ }).first().click();
    await expect(page.locator("#quick-age")).toHaveValue(/^\d+$/);

    await page.locator("#quick-gender").click();
    await page.getByRole("option", { name: "Male", exact: true }).click();
    await page.locator("#quick-blood").click();
    await page.getByRole("option", { name: "O+", exact: true }).click();
    await page.getByRole("button", { name: "+ Penicillin" }).click();

    await page.getByRole("button", { name: "Register & Create Visit" }).click();
    await expect(page.getByRole("heading", { name: "Visit created" })).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("Escape");

    // Nothing is left pending, because the details were captured up front.
    await page.reload();
    const row = page.getByRole("row").filter({ hasText: patientName });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByText("Details pending")).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Complete details" })).toHaveCount(0);
  });

  test("Complete details opens the edit form directly", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Runs once, on desktop.");
    test.setTimeout(120_000);
    await signIn(page, "reception");
    await page.goto("/reception");

    const button = page.getByRole("button", { name: "Complete details" }).first();
    test.skip(!(await button.count()), "No patient with pending details today.");
    await button.click();

    // Straight into the editor rather than the profile page's button.
    await page.waitForURL(/\/patients\/[0-9a-f-]{36}\?edit=1/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Edit patient" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Save Patient" })).toBeVisible();
  });
});
