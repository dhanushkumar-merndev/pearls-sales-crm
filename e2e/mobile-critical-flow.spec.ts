import { expect, test } from "@playwright/test";
import { credentialsConfigured, missingCredentials, signIn, type Role } from "./support/auth";

/**
 * AGENTS.md 3: the whole system must work on a phone. These run in the mobile
 * project (iPhone 13, 390px) and check the two things that actually break --
 * horizontal page overflow, and actions that become unreachable once the
 * sidebar collapses into a sheet.
 */
const pages: Array<[Role, string]> = [
  ["reception", "/reception"],
  ["reception", "/patients"],
  ["op", "/op"],
  ["doctor", "/doctor"],
  ["sales_executive", "/leads"],
  ["reception", "/reception/lead-appointments"],
  ["admin", "/admin/integrations/meta"],
  ["pharmacy", "/pharmacy"],
  ["pharmacy", "/pharmacy/stock"],
  ["admin", "/dashboard"],
];

test.describe("mobile", () => {
  test.skip(!credentialsConfigured, missingCredentials);

  for (const [role, route] of pages) {
    test(`${role} ${route} fits the viewport`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "mobile", "Mobile project only.");
      test.setTimeout(120_000);
      await signIn(page, role);
      await page.goto(route);
      // The heading moves into the app bar on a phone and stays in the page on
      // wider screens, so the assertion is that a VISIBLE h1 exists -- the
      // other copy is display:none and out of the accessibility tree.
      await expect(page.locator("h1:visible").first()).toBeVisible({ timeout: 30_000 });

      // Wide tables are allowed to scroll inside their own container, but the
      // page itself must never scroll sideways.
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth, `${route} overflows horizontally`).toBeLessThanOrEqual(
        overflow.clientWidth + 1,
      );

      // Navigation is reachable through the sheet trigger.
      await expect(page.getByRole("button", { name: /toggle sidebar/i })).toBeVisible();
    });
  }

  test("reception can reach the create-visit dialog on a phone", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Mobile project only.");
    test.setTimeout(120_000);
    await signIn(page, "reception");
    await page.goto("/reception");
    await page.getByRole("button", { name: "Find or Add Patient" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // The dialog must fit the phone, not spill past it.
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(box, "dialog should be laid out").toBeTruthy();
    if (box && viewport) {
      expect(box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.height).toBeLessThanOrEqual(viewport.height);
    }
    await expect(page.getByPlaceholder("UHID, mobile number or patient name")).toBeVisible();
  });
});
