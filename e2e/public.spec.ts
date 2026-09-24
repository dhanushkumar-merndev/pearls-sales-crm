import { expect, test } from "@playwright/test";

test("setup state is responsive and explains configuration", async ({ page }) => {
  await page.goto("/setup");
  // /setup only renders its instructions while Supabase is unconfigured; a
  // configured environment (the normal case once .env is filled in) sends the
  // visitor to the login screen instead.
  const heading = page.getByRole("heading", { name: /Connect Pearl/ });
  test.skip(!(await heading.count()), "Supabase is configured, so /setup does not render.");
  await expect(heading).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
});

test("login has no public signup", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  await expect(page.getByRole("link", { name: /sign up/i })).toHaveCount(0);
});
