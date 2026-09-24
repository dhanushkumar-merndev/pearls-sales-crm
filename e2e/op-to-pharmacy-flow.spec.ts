import { expect, test } from "@playwright/test";
import { credentialsConfigured, doctorDisplayName, missingCredentials, signIn } from "./support/auth";

/**
 * The Definition of Done flow, end to end against the real database:
 *
 *   reception registers -> token (no money on it) -> OP vitals -> doctor
 *   consultation with a fee and a medicine -> pharmacy dispenses -> stock drops
 *
 * It is one test rather than five because each step consumes the row the
 * previous step produced; splitting it would make the suite order-dependent.
 */

/**
 * Quantity of one batch row on the pharmacy stock screen, found by the brand
 * name shown in its first column. Read from the UI on purpose: it is the number
 * the pharmacist actually sees.
 */
async function batchQuantity(page: import("@playwright/test").Page, brand: string) {
  await page.goto(`/pharmacy/stock?q=${encodeURIComponent(brand)}`);
  const row = page.getByRole("row").filter({ hasText: brand }).first();
  await row.waitFor({ timeout: 15_000 });
  // Columns: Medicine | Generic | Batch | Expiry | Qty | Selling Price | Alert
  const qty = await row.getByRole("cell").nth(4).innerText();
  return Number(qty.replace(/[^0-9]/g, "")) || 0;
}

test.describe("OP visit through to pharmacy", () => {
  test.skip(!credentialsConfigured, missingCredentials);

  test("registration, vitals, consultation and dispensing", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Flow runs once, on desktop.");
    test.setTimeout(240_000);
    // A fresh patient each run keeps the test independent of seeded data.
    const stamp = Date.now().toString().slice(-9);
    const phone = `9${stamp}`;
    const patientName = `E2E Patient ${stamp.slice(-4)}`;

    const doctorName = doctorDisplayName;

    const reception = await browser.newPage();
    await signIn(reception, "reception");

    // --- Reception: register and create the visit ---------------------------
    await reception.goto("/reception");
    await reception.getByRole("button", { name: "Find or Add Patient" }).click();
    await reception.getByPlaceholder("UHID, mobile number or patient name").fill(phone);
    await reception.getByRole("button", { name: "Add new patient" }).click();
    await reception.getByLabel("Patient name *").fill(patientName);
    await reception.getByLabel("Mobile number *").fill(phone);
    // Patient details and visit details are one form for a first-time patient.
    // Route the visit to the doctor account the test signs in as, otherwise the
    // patient lands in another consultant's queue.
    await reception.getByLabel("Doctor").click();
    await reception.getByRole("option", { name: doctorName }).click();
    // Registration must not ask for money: the doctor sets the fee later.
    await expect(reception.getByLabel("Amount collected offline")).toHaveCount(0);
    await expect(reception.getByLabel("Consultation fee")).toHaveCount(0);
    await reception.getByRole("button", { name: "Register & Create Visit" }).click();

    await expect(reception.getByRole("heading", { name: "Visit created" })).toBeVisible({ timeout: 30_000 });
    const token = (await reception.locator("p.text-6xl").innerText()).trim();
    expect(Number(token)).toBeGreaterThan(0);

    // --- Token print carries no financial information (AGENTS.md 50) -------
    // shadcn Buttons that render a Link keep the button role.
    await Promise.all([
      reception.waitForURL(/\/print\/token\/[0-9a-f-]{36}/, { timeout: 30_000 }),
      reception.getByRole("button", { name: /Print Token/ }).click(),
    ]);
    await expect(reception.getByText("Token No")).toBeVisible();
    const tokenText = await reception.locator("article").innerText();
    expect(tokenText).toContain(patientName);
    expect(tokenText).toContain(phone);
    expect(tokenText).not.toMatch(/₹|fee|collected|balance|cash|upi/i);
    // The letterhead the hospital asked for.
    expect(tokenText).toContain("Pearl Aesthetic");
    expect(tokenText).toMatch(/Koramangala/);

    // OP has an independent staff session for vitals.
    const op = await browser.newPage();
    await signIn(op, "op");
    await op.goto("/op");
    const opRow = op.getByRole("row").filter({ hasText: patientName });
    await expect(opRow).toBeVisible({ timeout: 30_000 });
    await opRow.getByRole("button", { name: "Record Vitals" }).click();
    await op.getByLabel("Weight (kg)").fill("68");
    await op.getByLabel("Temperature (°F)").fill("100.8");
    await op.getByLabel("BP systolic").fill("120");
    await op.getByLabel("BP diastolic").fill("80");
    await op.getByLabel("Pulse / min").fill("82");
    await op.getByRole("button", { name: /Save/ }).click();
    await expect(op.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });

    // --- Pick a medicine the pharmacy genuinely stocks ---------------------
    // Chosen from the stock screen rather than guessed, so the dispense step
    // has a known batch to decrement.
    const stockPage = await browser.newPage();
    await signIn(stockPage, "pharmacy");
    await stockPage.goto("/pharmacy/stock");
    const stockedRow = stockPage.getByRole("row").filter({ hasText: "In Stock" }).first();
    await stockedRow.waitFor({ timeout: 30_000 });
    const brand = (await stockedRow.getByRole("cell").nth(0).innerText()).trim();
    const stockBefore = await batchQuantity(stockPage, brand);
    expect(stockBefore, "seed data must contain a stocked medicine").toBeGreaterThan(0);

    // --- Doctor: consult, set the fee, prescribe ---------------------------
    const doctor = await browser.newPage();
    await signIn(doctor, "doctor");
    await doctor.goto("/doctor");
    const doctorRow = doctor.getByRole("row").filter({ hasText: patientName });
    await expect(doctorRow).toBeVisible({ timeout: 30_000 });
    await doctorRow.getByRole("button", { name: /Open|Consult/ }).first().click();

    await doctor.getByLabel("Symptoms / Chief Complaint").fill("Fever for three days, body ache");
    await doctor.getByLabel("Examination").fill("Throat congested, chest clear");

    // The fallback directory is present even in an isolated test database that
    // has not received the separately licensed official RF2 import. It remains
    // uncoded and must never claim a verified SNOMED concept ID.
    //
    // "Add diagnosis" is the "+" beside the box, which adds whatever is typed
    // as a local term -- it is disabled until there IS something typed, so it
    // is not the way into the picker. The search button is.
    await doctor.getByRole("tab", { name: "SNOMED-CT" }).click();
    await doctor.getByRole("button", { name: /^Search SNOMED-CT$/ }).click();
    await doctor.getByPlaceholder("Search SNOMED-CT").fill("fever");
    const diagnosis = doctor.getByRole("option").filter({ hasText: /^Fever/i }).first();
    await diagnosis.waitFor({ timeout: 15_000 });
    const diagnosisText = (await diagnosis.innerText()).split("\n")[0].trim();
    await diagnosis.click();
    await expect(doctor.getByRole("button", { name: `Remove ${diagnosisText}` })).toBeVisible();

    // Prescribe from the local directory: type, then take a suggestion.
    await doctor.getByRole("button", { name: "Add Medicine" }).click();
    await doctor.getByRole("combobox", { name: "Search medicine" }).first().click();
    await doctor.getByPlaceholder("Type at least 2 letters").fill(brand);
    const suggestion = doctor.getByRole("option").filter({ hasText: brand }).first();
    await suggestion.waitFor({ timeout: 15_000 });
    const medicineName = (await suggestion.innerText()).split("\n")[0].trim();
    await suggestion.click();
    // The stocked row may be a syrup, injection, or tablet. The app changes
    // its prompt by dosage form, so address the labelled Dose field directly.
    await doctor.getByRole("textbox", { name: /^Dose/ }).first().fill("1");

    // A changed fee must survive the draft/reload path. This is also the form
    // Pharmacy uses when transcribing a consultant's paper prescription; it
    // previously snapped back to the doctor's configured master fee and staff
    // tried repeated tab refreshes to make the override appear.
    await doctor.locator("#consultation-fee").fill("450");
    await doctor.getByRole("button", { name: "Save Draft" }).click();
    await expect(doctor.getByText("Draft saved.")).toBeVisible({ timeout: 30_000 });
    await doctor.reload();
    await expect(doctor.locator("#consultation-fee")).toHaveValue("450.00");

    // The doctor sets the final fee; the pharmacy counter collects it.
    await doctor.locator("#consultation-fee").fill("500");

    await doctor.getByRole("button", { name: "Complete Consultation" }).click();
    await expect(doctor.getByText(/completed/i).first()).toBeVisible({ timeout: 30_000 });

    // --- Pharmacy: the prescription arrives, dispensing reduces stock ------
    const pharmacy = await browser.newPage();
    await signIn(pharmacy, "pharmacy");
    await pharmacy.goto("/pharmacy");
    const rxRow = pharmacy.getByRole("row").filter({ hasText: patientName });
    await expect(rxRow).toBeVisible({ timeout: 30_000 });
    // The pharmacy counter is told what the doctor charged.
    await expect(rxRow).toContainText("500");
    await rxRow.getByRole("button", { name: "Dispense" }).click();
    const dispenseDialog = pharmacy.getByRole("dialog");
    await expect(dispenseDialog).toContainText(medicineName.split(" ")[0]);

    // Prescribing alone must not have moved stock (AGENTS.md 28A).
    expect(await batchQuantity(stockPage, brand), "prescribing must not reduce stock").toBe(stockBefore);

    await expect(pharmacy.getByLabel(/Consultation fee collected/)).toHaveValue("500.00");
    await pharmacy.getByRole("button", {
      name: /^(Confirm (Full )?Dispense(?: With Extra)?|Dispense Available Quantity)$/,
    }).click();
    await expect(dispenseDialog).toHaveCount(0, { timeout: 30_000 });

    const stockAfter = await batchQuantity(stockPage, brand);
    expect(stockAfter, "dispensing must reduce batch stock").toBeLessThan(stockBefore);

    // And the sale is on record.
    await pharmacy.goto("/pharmacy/sales");
    await expect(pharmacy.getByRole("row").filter({ hasText: patientName })).toBeVisible({ timeout: 30_000 });

    await stockPage.close();
    await pharmacy.close();
    await doctor.close();
    await reception.close();
    await op.close();
  });
});
