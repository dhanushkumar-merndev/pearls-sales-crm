import { expect, test } from "@playwright/test";
import { credentialsConfigured, missingCredentials, signIn } from "./support/auth";

/**
 * Allergies are entered as tags: tap what the hospital already records, or type
 * anything that is not on the list. They round-trip through the patient record
 * as a single comma-separated string, so the stored shape did not change.
 */
test.describe("patient form", () => {
  test.skip(!credentialsConfigured, missingCredentials);

  test("suggests recorded allergies, accepts new ones, and saves them", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Runs once, on desktop.");
    test.setTimeout(180_000);
    const stamp = Date.now().toString().slice(-9);
    const phone = `9${stamp}`;
    const patientName = `Allergy Patient ${stamp.slice(-4)}`;

    await signIn(page, "reception");
    await page.goto("/patients");
    await page.getByRole("button", { name: "Add Patient" }).click();

    await page.getByLabel("Name *").fill(patientName);
    await page.getByLabel("Mobile number *").fill(phone);

    // A one-tap chip drawn from what is already on file.
    const suggestion = page.getByRole("button", { name: "+ Penicillin" });
    await expect(suggestion).toBeVisible({ timeout: 15_000 });
    await suggestion.click();
    await expect(suggestion, "a chosen allergy leaves the suggestions").toHaveCount(0);

    // Free text: Enter adds the tag and must not submit the patient form.
    const box = page.getByLabel("Add an allergy");
    await box.fill("Crab shell");
    await box.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();

    // The same allergy in different case is not added twice.
    await box.fill("penicillin");
    await box.press("Enter");
    await expect(page.getByLabel(/^Remove /)).toHaveCount(2);

    await expect(page.locator('input[name="allergies"]')).toHaveValue("Penicillin, Crab shell");

    await page.getByRole("button", { name: "Create Patient" }).click();
    await page.waitForURL(/\/patients\/[0-9a-f-]{36}/, { timeout: 30_000 });

    // Saved, and it comes back as tags when the record is edited.
    await page.getByRole("button", { name: "Edit Patient" }).click();
    await expect(page.getByLabel("Remove Penicillin")).toBeVisible();
    await expect(page.getByLabel("Remove Crab shell")).toBeVisible();
  });

  test("fills the age in from the date of birth", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Runs once, on desktop.");
    test.setTimeout(120_000);
    await signIn(page, "reception");
    await page.goto("/patients");
    await page.getByRole("button", { name: "Add Patient" }).click();

    // Free to type an age while no birth date is known.
    const age = page.locator("#patient-age");
    await expect(age).toBeEnabled();
    await expect(age).toBeEmpty();

    await page.getByRole("button", { name: "Date of birth" }).click();
    await page.getByRole("gridcell").filter({ hasText: /^15$/ }).first().click();

    // A chosen date fills the age in, but the field stays editable.
    await expect(page.locator('input[name="dob"]')).not.toHaveValue("");
    await expect(age).toHaveValue(/^\d+$/);
    await expect(age).toBeEnabled();
    await expect(page.getByText(/Calculated from the date of birth/)).toBeVisible();

    // Typing an age by hand overrides the date rather than being discarded:
    // the server keeps the date whenever one is present.
    await age.fill("47");
    await expect(page.locator('input[name="dob"]')).toHaveValue("");
    await expect(page.getByText("Saved as an approximate date of birth.")).toBeVisible();
  });
});
