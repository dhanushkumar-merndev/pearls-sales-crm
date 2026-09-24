import { expect, test } from "@playwright/test";
import { credentialsConfigured, missingCredentials, signIn, type Role } from "./support/auth";

/**
 * A staff member does not log in again for every page they use. These journeys
 * exercise the real session shape: one sign-in, a sequence of permitted pages,
 * an explicit sign-out, a protected-route check, then sign-in again as the
 * same role. Route-isolation.spec.ts remains deliberately separate so each
 * denied route is also proven in a clean browser context.
 */
const journeys: Array<[Role, string[]]> = [
  ["admin", ["/patients", "/reception", "/doctor", "/leads", "/pharmacy", "/admin/users", "/audit"]],
  ["reception", ["/patients", "/reception", "/reception/lead-appointments", "/reception/follow-ups", "/reception/payments"]],
  ["doctor", ["/doctor", "/doctor/follow-ups", "/reports"]],
  ["op", ["/op", "/op/assist", "/reports", "/drug-stock"]],
  ["sales_executive", ["/leads", "/leads/follow-ups", "/leads/booked"]],
  ["pharmacy", ["/pharmacy", "/pharmacy/stock", "/pharmacy/medicines", "/pharmacy/sales"]],
];

async function openAllowedRoute(page: Parameters<typeof signIn>[0], role: Role, route: string) {
  // Verify the final state after a server redirect.
  const response = await page.goto(route).catch((error: unknown) => {
    if (error instanceof Error && error.message.includes("ERR_ABORTED")) return null;
    throw error;
  });
  if (response) expect(response.status(), `${role} opens ${route} during one session`).toBe(200);
  await expect(page, `${role} stays authorized for ${route}`).not.toHaveURL(/(?:forbidden=1|\/login)/);
}

test.describe("continuous staff session journeys", () => {
  test.skip(!credentialsConfigured, missingCredentials);

  for (const [role, routes] of journeys) {
    test(`${role} continues its own workflow after signing in again`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "The journey is viewport-independent and runs once.");
      test.setTimeout(120_000);

      await signIn(page, role);
      for (const route of routes) {
        await openAllowedRoute(page, role, route);
      }

      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(page).toHaveURL(/\/login/);

      await page.goto(routes[0]);
      await expect(page, `${role} is blocked after signing out`).toHaveURL(/\/login/);

      await signIn(page, role);
      await openAllowedRoute(page, role, routes[0]);
    });
  }
});
