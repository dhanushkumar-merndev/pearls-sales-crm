import { expect, test } from "@playwright/test";
import { credentialsConfigured, missingCredentials, passwordFor, signIn } from "./support/auth";

test("admin-created sales staff can sign in with an active sales profile", async ({ browser }, info) => {
  test.skip(!credentialsConfigured, missingCredentials);
  test.skip(info.project.name !== "desktop", "Provision once in the shared database.");
  test.setTimeout(90_000);
  const adminContext = await browser.newContext();
  const staffContext = await browser.newContext();
  try {
    const admin = await adminContext.newPage();
    await signIn(admin, "admin");
    await admin.goto("/admin/users");
    await admin.getByRole("button", { name: "Add User" }).click();
    const email = `qa.created.${Date.now()}@example.invalid`;
    const dialog = admin.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill("ZZ E2E Created Sales");
    await dialog.getByLabel("Email", { exact: true }).fill(email);
    await dialog.getByLabel("Temporary password").fill(passwordFor("sales_executive")!);
    await dialog.getByRole("combobox").click();
    await admin.getByRole("option", { name: "Sales Executive" }).click();
    await dialog.getByRole("button", { name: "Create User" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    const staff = await staffContext.newPage();
    await staff.goto("/login");
    await staff.getByLabel("Email").fill(email);
    await staff.getByLabel("Password", { exact: true }).fill(passwordFor("sales_executive")!);
    await staff.getByRole("button", { name: "Sign In" }).click();
    await expect(staff).toHaveURL(/dashboard/);
    await expect(staff.getByTestId("current-role")).toHaveText("sales_executive");
    await staff.goto("/leads");
    await expect(staff.locator("h1:visible").first()).toHaveText("My leads");
  } finally {
    await adminContext.close();
    await staffContext.close();
  }
});
