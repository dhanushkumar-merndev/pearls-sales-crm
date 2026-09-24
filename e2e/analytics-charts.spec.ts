import { expect, test } from "@playwright/test";
import { credentialsConfigured, missingCredentials, signIn } from "./support/auth";

const tabs = ["OP", "Doctors", "Pharmacy", "Collections", "Patients"];

test.describe("admin analytics charts", () => {
  test.skip(!credentialsConfigured, missingCredentials);
  test("every analytics tab renders its own echarts canvas", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Desktop project only");
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message)); page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await signIn(page, "admin");
    await page.goto("/admin/analytics");
    await expect(page.getByRole("img", { name: "Patient visits per day" }).locator("canvas")).toBeVisible();
    await expect(page.getByRole("img", { name: "Daily collections by source" }).locator("canvas")).toBeVisible();
    for (const tab of tabs) { await page.getByRole("tab", { name: tab, exact: true }).click(); await expect(page.locator("[role=tabpanel]:visible canvas").first()).toBeVisible(); }
    await page.getByRole("tab", { name: "Leads", exact: true }).click();
    await expect(page.getByText("Sales executive outcomes", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
