import { expect, test } from "@playwright/test";
import { credentialsConfigured, missingCredentials, signIn } from "./support/auth";

const routes = ["/dashboard", "/patients", "/reception", "/op", "/doctor", "/leads", "/leads/follow-ups", "/leads/booked", "/admin/integrations/meta", "/reception/lead-appointments", "/pharmacy", "/reports", "/admin/users", "/admin/doctors", "/admin/masters", "/admin/masters?tab=charges", "/admin/masters?tab=report-categories", "/admin/clinical-directory", "/pharmacy/medicines", "/pharmacy/inventory", "/pharmacy/inventory?tab=bills", "/pharmacy/import", "/patients/import", "/admin/clinical-directory/import", "/op/assist", "/reception/payments", "/reception/payments?view=collected", "/admin/exports", "/admin/settings", "/admin/analytics", "/audit"];

test.describe("authenticated admin application", () => {
  test.skip(!credentialsConfigured, missingCredentials);
  test("all administration and operational pages render without console errors", async ({ page }) => {
    // Walks ~30 routes against the dev server, which compiles each one on first
    // visit; the default 30s budget is not enough when other specs are running
    // in parallel and competing for that compilation.
    test.setTimeout(300_000);
    const errors: string[] = []; page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); }); page.on("pageerror", (error) => errors.push(error.message));
    await signIn(page, "admin");
    for (const route of routes) { const response = await page.goto(route); expect(response?.status(), route).toBe(200); await expect(page.locator("h1:visible").first(), route).toBeVisible(); }
    expect(errors).toEqual([]);
  });
  test("mobile dashboard has a reachable sidebar and no page overflow", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Mobile project only");
    await signIn(page, "admin");
    await expect(page.getByRole("button", { name: /toggle sidebar/i })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });
});
