import { expect, test } from "@playwright/test";
import { credentialsConfigured, missingCredentials, signIn } from "./support/auth";
import { lookupPrescriptions } from "./support/fixtures";

/**
 * Every printed document must carry the hospital letterhead the client asked
 * for -- logo, name, the "Care - Healing - Hope." motto, and the full address
 * and contact block -- and the token must carry no money at all.
 */
const LETTERHEAD = ["Pearl Aesthetic", "Koramangala", "info@pearlaesthetic.in"];

test.describe("printed documents", () => {
  test.skip(!credentialsConfigured, missingCredentials);

  test("prescription prints the letterhead and the clinical content", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Print layout is checked on A4 width.");
    test.setTimeout(120_000);
    // Admin rather than the doctor account: the completed visit that exists on
    // any given day may belong to another consultant, and the doctor queue only
    // ever shows their own patients.
    await signIn(page, "admin");

    // The newest completed visit may deliberately have no medicines. Select
    // an actual printable prescription instead of skipping on that visit.
    const { op: prescriptionId } = await lookupPrescriptions();
    expect(prescriptionId, "The clinical workflow must create a printable prescription").toBeTruthy();
    await page.goto(`/print/prescription/${prescriptionId}`);
    await expect(page).toHaveURL(/print\/prescription/);

    const article = page.locator("article");
    await expect(article).toBeVisible();
    const text = await article.innerText();
    for (const line of LETTERHEAD) expect(text, `prescription letterhead: ${line}`).toContain(line);
    expect(text).toContain("Pearl");
    // Doctor identity block (AGENTS.md 24).
    expect(text).toMatch(/Registration/i);
  });

  test("token print never shows money", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Print layout is checked on A4 width.");
    test.setTimeout(120_000);
    await signIn(page, "reception");
    await page.goto("/reception");
    const row = page.getByRole("row").filter({ hasText: /#\d+/ }).first();
    // Without waiting first, the count runs before the table renders and the
    // test skipped itself instead of checking anything.
    await row.waitFor({ timeout: 30_000 }).catch(() => {});
    test.skip(!(await row.count()), "No visit today to print a token for.");
    await row.getByRole("button", { name: "Open" }).first().click();
    await page.getByRole("button", { name: /Print Token|Token/ }).first().click();
    await expect(page).toHaveURL(/print\/token/);
    const text = await page.locator("article").innerText();
    expect(text).not.toMatch(/₹|fee|collected|balance|payment|cash|upi/i);
    for (const line of LETTERHEAD) expect(text, `token letterhead: ${line}`).toContain(line);
  });
});
