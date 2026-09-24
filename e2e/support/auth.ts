import { expect, type Page } from "@playwright/test";

export type Role = "admin" | "reception" | "op" | "doctor" | "sales_executive" | "pharmacy";

/**
 * Staff sign-in for E2E.
 *
 * E2E_PASSWORD is the shared fallback, but the accounts do not have to share
 * one: a role whose password differs (an account still on the credentials
 * handed out at go-live, say) is configured with E2E_<ROLE>_PASSWORD. Emails
 * are overridden the same way with E2E_<ROLE>_EMAIL.
 */
const sharedPassword = process.env.E2E_PASSWORD ?? process.env.E2E_ADMIN_PASSWORD;

export const credentialsConfigured = Boolean(sharedPassword);
export const missingCredentials =
  "Set E2E_PASSWORD (and the role emails, if they differ from the defaults) to run authenticated tests.";

export function emailFor(role: Role) {
  const override = process.env[`E2E_${role.toUpperCase()}_EMAIL`];
  if (override) return override;
  if (role === "admin" && process.env.E2E_ADMIN_EMAIL) return process.env.E2E_ADMIN_EMAIL;
  return `${role}@meenakshihospital.com`;
}

export function passwordFor(role: Role) {
  return process.env[`E2E_${role.toUpperCase()}_PASSWORD`] ?? sharedPassword;
}

export async function signIn(page: Page, role: Role) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(emailFor(role));
    // exact: the show/hide toggle button's own aria-label ("Show password")
    // otherwise also matches this substring search.
    await page.getByLabel("Password", { exact: true }).fill(passwordFor(role)!);
    await page.getByRole("button", { name: "Sign In" }).click();

    try {
      await expect(page).toHaveURL(/dashboard/, { timeout: 20_000 });
      // The mobile sidebar mounts its role badge only while the sheet is open.
      const mobile = (page.viewportSize()?.width ?? 1280) < 768;
      if (mobile) await page.getByRole("button", { name: /toggle sidebar/i }).click();
      await expect(page.getByTestId("current-role")).toHaveText(
        new RegExp(`^${role}$`, "i"),
        { timeout: 20_000 },
      );
      if (mobile) await page.keyboard.press("Escape");
      return;
    } catch (error) {
      const message = await page.getByRole("alert").textContent().catch(() => null);
      // A rendered login error is a real authentication failure. Retrying would
      // hide a broken credential; only retry a session/navigation handoff that
      // left the page silently on /login during a long live-data suite.
      if (message || attempt === 1) throw error;
    }
  }
}

/**
 * Display name of the doctor the "doctor" account is linked to. Reception must
 * route the E2E visit to this consultant for it to reach that doctor's queue.
 */
export const doctorDisplayName = process.env.E2E_DOCTOR_NAME ?? "Dr Dharsan";
