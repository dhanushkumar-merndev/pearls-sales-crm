import { expect, test } from "@playwright/test";
import { credentialsConfigured, missingCredentials, signIn, type Role } from "./support/auth";

/**
 * AGENTS.md 69: hiding a link is not security. Each role is walked to routes it
 * must not reach; the guard sends it back to its own dashboard.
 *
 * The database is the real boundary (RLS + the definer-RPC role guards); these
 * checks cover the routing layer that sits in front of it.
 */
const forbidden: Array<[Role, string[]]> = [
  ["reception", ["/admin/users", "/admin/doctors", "/admin/settings", "/audit", "/pharmacy/stock", "/pharmacy/import", "/op", "/leads"]],
  ["doctor", ["/admin/users", "/admin/settings", "/pharmacy/stock", "/pharmacy/import", "/reception/payments", "/audit"]],
  ["op", ["/admin/users", "/admin/settings", "/pharmacy/import", "/audit", "/reception/payments", "/leads"]],
  ["sales_executive", ["/admin/users", "/patients", "/doctor", "/pharmacy", "/reception", "/op", "/audit"]],
  ["pharmacy", ["/admin/users", "/admin/settings", "/reception", "/op", "/doctor", "/audit"]],
];

const allowed: Array<[Role, string[]]> = [
  ["reception", ["/reception", "/patients", "/reception/payments", "/reception/follow-ups", "/reception/lead-appointments", "/drug-stock"]],
  ["doctor", ["/doctor", "/doctor/follow-ups"]],
  ["op", ["/op", "/op/assist", "/patients", "/reports", "/drug-stock"]],
  ["sales_executive", ["/leads", "/leads/follow-ups", "/leads/booked"]],
  ["pharmacy", ["/pharmacy", "/pharmacy/stock", "/pharmacy/medicines", "/pharmacy/sales"]],
  ["admin", ["/admin/users", "/admin/settings", "/audit", "/pharmacy/stock", "/reception", "/leads", "/admin/integrations/meta"]],
];

test.describe("role isolation", () => {
  test.skip(!credentialsConfigured, missingCredentials);

  for (const [role, routes] of forbidden) {
    test(`${role} cannot open another role's pages`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "Routing guard is not viewport dependent.");
      test.setTimeout(120_000);
      await signIn(page, role);
      for (const route of routes) {
        await page.goto(route);
        await expect(page, `${role} should be bounced from ${route}`).toHaveURL(/dashboard\?forbidden=1/);
      }
    });
  }

  for (const [role, routes] of allowed) {
    test(`${role} can open its own pages`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "Routing guard is not viewport dependent.");
      test.setTimeout(120_000);
      await signIn(page, role);
      for (const route of routes) {
        const response = await page.goto(route);
        expect(response?.status(), route).toBe(200);
        await expect(page, `${role} should reach ${route}`).not.toHaveURL(/forbidden=1/);
        // ":visible": the app bar carries its own <h1> for the phone layout
        // (hidden from sm: up), and it comes first in the DOM.
        await expect(page.locator("h1:visible").first(), route).toBeVisible();
      }
    });
  }
});
