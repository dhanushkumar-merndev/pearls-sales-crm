import { expect, test } from "@playwright/test";
import { credentialsConfigured, missingCredentials, signIn } from "./support/auth";

test.describe("clinic enquiry workflow", () => {
  test.skip(!credentialsConfigured, missingCredentials);
  test("sales records a call, books a patient and reception creates the visit", async ({ browser }, info) => {
    test.skip(info.project.name !== "desktop", "Runs once against the shared database.");
    test.setTimeout(180_000);
    const salesContext = await browser.newContext();
    const receptionContext = await browser.newContext();
    try {
      const sales = await salesContext.newPage();
      const reception = await receptionContext.newPage();
      const stamp = Date.now().toString().slice(-9);
      const name = `ZZ E2E Enquiry ${stamp}`;
      await signIn(sales, "sales_executive");
      await sales.goto("/leads");
      await sales.getByRole("button", { name: "Add enquiry" }).click();
      await sales.getByLabel("Full name", { exact: true }).fill(name);
      await sales.getByLabel("Mobile number", { exact: true }).fill(`9${stamp}`);
      await sales.getByLabel("Procedure of interest").fill("Consultation");
      await sales.getByRole("button", { name: "Create enquiry", exact: true }).click();
      await sales.getByRole("button", { name: "Open enquiry", exact: true }).click();
      await expect(sales).toHaveURL(/\/leads\/[0-9a-f-]{36}$/);
      const leadUrl = sales.url();
      await sales.getByLabel("Call outcome / note").fill("E2E: patient requested an appointment");
      const due = new Date(Date.now() + 330 * 60_000 - 60_000).toISOString().slice(0, 16);
      await sales.getByLabel("Next follow-up (IST)").first().fill(due);
      await sales.getByRole("button", { name: "Save activity" }).click();
      await expect(sales.getByText("E2E: patient requested an appointment", { exact: false }).last()).toBeVisible();
      await sales.goto("/leads/follow-ups");
      await expect(sales.getByRole("row").filter({ hasText: name })).toBeVisible();
      await sales.goto(leadUrl);
      const appointment = new Date(Date.now() + 330 * 60_000 + 5 * 60_000).toISOString().slice(0, 16);
      await sales.getByLabel("Appointment (IST)", { exact: true }).fill(appointment);
      await sales.getByRole("button", { name: "Book appointment", exact: true }).click();
      await expect(sales.getByText("Reschedule appointment", { exact: true })).toBeVisible();
      await sales.goto("/leads/booked");
      await expect(sales.getByRole("row").filter({ hasText: name })).toBeVisible();

      await signIn(reception, "reception");
      await reception.goto(`/reception/lead-appointments?date=${appointment.slice(0, 10)}`);
      const row = reception.getByRole("row").filter({ hasText: name });
      await expect(row).toContainText("PA-");
      await row.getByRole("button", { name: "Create Visit" }).click();
      await reception.getByRole("dialog").getByRole("button", { name: "Create Visit", exact: true }).click();
      await expect(reception.getByRole("heading", { name: "Visit created" })).toBeVisible();
      await sales.goto(leadUrl);
      await expect(sales.getByText("converted", { exact: true }).first()).toBeVisible();
      await expect(sales.getByText("Visit created at reception", { exact: true })).toBeVisible();
      await expect(sales.getByRole("button", { name: "Book appointment", exact: true })).toHaveCount(0);
      await expect(sales.getByRole("button", { name: "Open patient", exact: true })).toHaveCount(0);
    } finally {
      await salesContext.close();
      await receptionContext.close();
    }
  });

  test("lead pages and enquiry dialog fit all required widths", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "Explicit widths cover phones and desktops.");
    test.setTimeout(180_000);
    await signIn(page, "admin");
    for (const width of [375, 430, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ["/leads", "/leads/follow-ups", "/leads/booked", "/reception/lead-appointments", "/admin/integrations/meta"]) {
        await page.goto(route);
        await expect(page.locator("h1:visible").first()).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${route} at ${width}px`).toBeLessThanOrEqual(1);
      }
      await page.goto("/leads");
      if (width < 640) {
        const button = page.getByRole("button", { name: "Add enquiry" });
        const box = await button.boundingBox();
        expect(box).toBeTruthy();
        expect(box!.width, `Add enquiry should fill the ${width}px phone content area`).toBeGreaterThanOrEqual(width - 32);
      }
      await page.getByRole("button", { name: "Add enquiry" }).click();
      const dialog = page.getByRole("dialog");
      const box = await dialog.boundingBox();
      expect(box).toBeTruthy();
      expect(box!.width).toBeLessThanOrEqual(width);
      expect(box!.height).toBeLessThanOrEqual(900);
      await page.keyboard.press("Escape");
    }
  });
});
