import { expect, test } from "@playwright/test";
import { credentialsConfigured, missingCredentials, signIn } from "./support/auth";

test.describe("referral partners", () => {
  test.skip(!credentialsConfigured, missingCredentials);

  test("admin adds a partner, sales logs a referred enquiry, admin records the package", async ({ browser }, info) => {
    test.skip(info.project.name !== "desktop", "Runs once against the shared database.");
    test.setTimeout(180_000);
    const adminContext = await browser.newContext();
    const salesContext = await browser.newContext();
    try {
      const admin = await adminContext.newPage();
      const sales = await salesContext.newPage();
      const stamp = Date.now().toString().slice(-9);
      const partner = `ZZ E2E Partner ${stamp}`;
      const leadName = `ZZ E2E Referral ${stamp}`;

      await signIn(admin, "admin");
      await admin.goto("/admin/referrals?tab=partners");
      await admin.getByRole("button", { name: "Add Partner" }).click();
      const partnerDialog = admin.getByRole("dialog");
      await partnerDialog.getByLabel("Partner name *").fill(partner);
      await partnerDialog.getByLabel("Default incentive (%)").fill("12.5");
      await partnerDialog.getByRole("button", { name: "Save Partner" }).click();
      await expect(partnerDialog).toBeHidden();
      await admin.goto(`/admin/referrals?tab=partners&q=${encodeURIComponent(partner)}`);
      await expect(admin.getByRole("row").filter({ hasText: partner })).toContainText("12.5%");

      // Sales executives never reach the finance page or its export.
      await signIn(sales, "sales_executive");
      await sales.goto("/admin/referrals");
      await expect(sales).toHaveURL(/\/dashboard/);
      expect((await sales.request.get("/api/admin/referrals/export")).status()).toBe(403);

      await sales.goto("/leads");
      await sales.getByRole("button", { name: "Add enquiry" }).click();
      await sales.getByLabel("Full name", { exact: true }).fill(leadName);
      await sales.getByLabel("Mobile number", { exact: true }).fill(`9${stamp}`);
      await sales.getByLabel("Procedure of interest").fill("Hydrafacial");
      await sales.getByLabel("Referred by").click();
      await sales.getByRole("option", { name: partner, exact: true }).click();
      await sales.getByRole("button", { name: "Create enquiry", exact: true }).click();
      await sales.getByRole("button", { name: "Open enquiry", exact: true }).click();
      await expect(sales.getByText(`Referred by: ${partner}`)).toBeVisible();

      await admin.goto(`/admin/referrals?q=${encodeURIComponent(leadName)}`);
      const row = admin.getByRole("row").filter({ hasText: leadName });
      await expect(row).toContainText("Referral");
      await expect(row).toContainText(partner);
      await expect(row).toContainText("12.5%");
      await row.getByRole("button", { name: "Add package" }).click();
      const packageDialog = admin.getByRole("dialog");
      await packageDialog.getByLabel("Procedure / package *").fill("Hydrafacial x3");
      await packageDialog.getByLabel("Package value (₹) *").fill("15000");
      await packageDialog.getByRole("button", { name: "Save", exact: true }).click();
      await expect(packageDialog).toBeHidden();
      await expect(row).toContainText("Hydrafacial x3");
      await expect(row).toContainText("₹15,000.00");

      const csv = await admin.request.get(`/api/admin/referrals/export?q=${encodeURIComponent(leadName)}`);
      expect(csv.status()).toBe(200);
      const body = await csv.text();
      expect(body).toContain("Incentive Amount");
      expect(body).toContain(leadName);
    } finally {
      await adminContext.close();
      await salesContext.close();
    }
  });
});
