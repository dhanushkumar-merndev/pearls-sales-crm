import { expect, test } from "@playwright/test";
import { credentialsConfigured, missingCredentials, signIn } from "./support/auth";

/**
 * A patient may see more than one consultant in the same sitting. Each doctor
 * issues a token from their own daily series (AGENTS.md 15 / the client's
 * per-doctor numbering), and the department is always read from the doctor
 * rather than picked separately.
 */
test.describe("multi-consultant visit", () => {
  test.skip(!credentialsConfigured, missingCredentials);

  test("adds a second doctor, each with their own department and token", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Runs once, on desktop.");
    test.setTimeout(180_000);
    await signIn(page, "reception");
    await page.goto("/patients");
    await page
      .getByRole("row")
      .filter({ hasText: /\d{10}/ })
      .first()
      .getByRole("button", { name: /Open|View/ })
      .first()
      .click();
    await page.waitForURL(/\/patients\/[0-9a-f-]{36}/, { timeout: 30_000 });
    await page.getByRole("button", { name: "Create Visit" }).click();

    // Department is derived, never typed.
    const department = page.locator("#visit-department");
    await expect(department).toHaveAttribute("readonly", "");
    await expect(department).not.toHaveValue("");
    await expect(department).not.toHaveValue("—");

    await page.getByRole("button", { name: "Add another doctor" }).click();

    // The extra consultant carries its own doctor and department pair.
    const departments = page.locator('input[id^="visit-department"]');
    await expect(departments).toHaveCount(2);
    await expect(departments.nth(1)).toHaveAttribute("readonly", "");
    await expect(departments.nth(1)).not.toHaveValue("—");

    // Both consultants are submitted, and never the same doctor twice.
    const payload = JSON.parse(await page.locator('input[name="consultants"]').inputValue());
    expect(payload).toHaveLength(2);
    expect(new Set(payload.map((entry: { doctorId: string }) => entry.doctorId)).size).toBe(2);

    await page.getByRole("button", { name: "Create Visit" }).last().click();
    await expect(page.getByRole("heading", { name: "Visit created" })).toBeVisible({ timeout: 30_000 });

    // One token per doctor, both listed.
    const summary = page.getByText(/token #\d+.*token #\d+/);
    await expect(summary).toBeVisible();

    // Removing the extra consultant returns the form to a single doctor.
    await page.getByRole("button", { name: "Close" }).click();
    // The page trigger and the form's submit share this label.
    await page.getByRole("button", { name: "Create Visit" }).first().click();
    await page.getByRole("button", { name: "Add another doctor" }).click();
    await page.getByRole("button", { name: /Remove additional doctor/ }).click();
    await expect(page.locator('input[id^="visit-department"]')).toHaveCount(1);
  });

  test("a second visit gets its own token instead of replaying the first", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Runs once, on desktop.");
    test.setTimeout(180_000);
    await signIn(page, "reception");
    await page.goto("/patients");
    await page
      .getByRole("row")
      .filter({ hasText: /\d{10}/ })
      .first()
      .getByRole("button", { name: /Open|View/ })
      .first()
      .click();
    await page.waitForURL(/\/patients\/[0-9a-f-]{36}/, { timeout: 30_000 });

    const tokens: string[] = [];
    for (const round of [1, 2]) {
      await page.getByRole("button", { name: "Create Visit" }).first().click();
      // The form comes back rather than the previous success panel.
      await expect(page.getByRole("heading", { name: "Create visit" }), `round ${round}`).toBeVisible();
      await page.getByRole("button", { name: "Create Visit" }).last().click();
      await expect(page.getByRole("heading", { name: "Visit created" })).toBeVisible({ timeout: 30_000 });
      tokens.push((await page.locator("p.text-5xl").innerText()).trim());
      await page.getByRole("button", { name: "Close" }).click();
    }
    // A reused idempotency key would have replayed the first visit and shown
    // the same token twice.
    expect(new Set(tokens).size, `tokens were ${tokens.join(" and ")}`).toBe(2);
  });

  test("registering a second patient books the visit against that patient", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Runs once, on desktop.");
    test.setTimeout(180_000);
    await signIn(page, "reception");
    await page.goto("/reception");

    const names: string[] = [];
    for (const round of [1, 2]) {
      const stamp = `${Date.now()}${round}`.slice(-9);
      const name = `Repeat Test ${stamp.slice(-4)}`;
      names.push(name);
      await page.getByRole("button", { name: "Find or Add Patient" }).click();
      await expect(page.getByRole("heading", { name: "Find or add patient" })).toBeVisible();
      await page.getByPlaceholder("UHID, mobile number or patient name").fill(`9${stamp}`);
      await page.getByRole("button", { name: "Add new patient" }).click();
      await page.getByLabel("Patient name *").fill(name);
      await page.getByLabel("Mobile number *").fill(`9${stamp}`);
      await page.getByRole("button", { name: "Register & Create Visit" }).click();
      // The token must belong to the patient just registered, not the previous one.
      await expect(page.getByRole("heading", { name: "Visit created" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(`${name} has been added to the doctor queue.`)).toBeVisible();
      await page.keyboard.press("Escape");
    }

    // Both patients are in today's queue, each with their own visit.
    for (const name of names) {
      await expect(page.getByRole("row").filter({ hasText: name })).toBeVisible({ timeout: 30_000 });
    }
  });

  test("the printed token lists every consultant with their own number", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Runs once, on desktop.");
    test.setTimeout(180_000);
    const stamp = Date.now().toString().slice(-9);
    const patientName = `Two Doctors ${stamp.slice(-4)}`;

    await signIn(page, "reception");
    await page.goto("/reception");
    await page.getByRole("button", { name: "Find or Add Patient" }).click();
    await page.getByPlaceholder("UHID, mobile number or patient name").fill(`9${stamp}`);
    await page.getByRole("button", { name: "Add new patient" }).click();
    await page.getByLabel("Patient name *").fill(patientName);
    await page.getByLabel("Mobile number *").fill(`9${stamp}`);
    await page.getByRole("button", { name: "Add another doctor" }).click();
    await page.getByRole("button", { name: "Register & Create Visit" }).click();
    await expect(page.getByRole("heading", { name: "Visit created" })).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: /Print Token/ }).click();
    await expect(page).toHaveURL(/print\/token/);

    const token = page.locator("article");
    await expect(token.getByText("All consultants today")).toBeVisible();
    // Scope to consultant lines: the clinic's address also starts with #755.
    // Independent doctor counters may legitimately issue the same number.
    const numbers = (await token.getByRole("list").innerText()).match(/#(\d+)/g) ?? [];
    expect(numbers.length, "one token number per consultant").toBe(2);

    // Still no money anywhere on the token (AGENTS.md 50).
    expect(await token.innerText()).not.toMatch(/₹|fee|collected|balance|payment|cash|upi/i);
  });
});
