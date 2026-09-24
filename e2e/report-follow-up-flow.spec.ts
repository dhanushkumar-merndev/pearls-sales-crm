import { expect, test } from "@playwright/test";
import { credentialsConfigured, doctorDisplayName, missingCredentials, signIn } from "./support/auth";

/**
 * AGENTS.md 27, the report follow-up flow, end to end:
 *
 *   visit 1 -> doctor orders a test and sets Follow-up = After report ->
 *   consultation completed -> report uploaded against that order -> it shows
 *   as ready -> reception creates a LINKED follow-up -> visit 2 gets its own
 *   token -> the doctor sees it on their follow-up queue
 *
 * The rule the flow exists to protect is the last assertion: visit 1 is never
 * reopened as the follow-up. It stays completed, with its own token, and the
 * follow-up is a separate visit that points back at it.
 *
 * Everything it creates carries the "E2E Patient" teardown marker.
 */
test.describe.configure({ mode: "serial" });

const TEST_NAME = "CBC";

test.describe("report follow-up", () => {
  test.skip(!credentialsConfigured, missingCredentials);

  test("an ordered test becomes a report, and the report becomes a linked follow-up visit", async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "The flow runs once, on desktop.");
    test.setTimeout(420_000);

    const stamp = Date.now().toString().slice(-9);
    const phone = `9${stamp}`;
    const patientName = `E2E Patient Report ${stamp.slice(-4)}`;

    // === RECEPTION: register and open visit 1 =============================
    const reception = await browser.newPage();
    await signIn(reception, "reception");
    await reception.goto("/reception");
    await reception.getByRole("button", { name: "Find or Add Patient" }).click();
    await reception.getByPlaceholder("UHID, mobile number or patient name").fill(phone);
    await reception.getByRole("button", { name: "Add new patient" }).click();
    await reception.getByLabel("Patient name *").fill(patientName);
    await reception.getByLabel("Mobile number *").fill(phone);
    await reception.getByLabel("Doctor").click();
    await reception.getByRole("option", { name: doctorDisplayName }).click();
    await reception.getByRole("button", { name: "Register & Create Visit" }).click();
    await expect(reception.getByRole("heading", { name: "Visit created" })).toBeVisible({ timeout: 30_000 });
    const firstToken = (await reception.locator("p.text-6xl").innerText()).trim();

    const op = await browser.newPage();
    await signIn(op, "op");
    await op.goto("/op");
    const opRow = op.getByRole("row").filter({ hasText: patientName });
    await expect(opRow).toBeVisible({ timeout: 30_000 });
    await opRow.getByRole("button", { name: "Record Vitals" }).click();
    await op.getByLabel("Weight (kg)").fill("64");
    await op.getByLabel("Temperature (°F)").fill("99.8");
    await op.getByLabel("BP systolic").fill("118");
    await op.getByLabel("BP diastolic").fill("76");
    await op.getByLabel("Pulse / min").fill("76");
    await op.getByRole("button", { name: /Save/ }).click();
    await expect(op.getByRole("dialog")).toHaveCount(0, { timeout: 30_000 });

    // === DOCTOR: order the test and ask for a follow-up after the report ==
    const doctor = await browser.newPage();
    await signIn(doctor, "doctor");
    await doctor.goto("/doctor");
    const doctorRow = doctor.getByRole("row").filter({ hasText: patientName });
    await expect(doctorRow).toBeVisible({ timeout: 30_000 });
    const consultationAction = doctorRow.getByRole("button", { name: /Open|Consult/ }).first();
    await Promise.all([
      doctor.waitForURL(/\/visits\/[0-9a-f-]{36}/, { timeout: 30_000 }),
      consultationAction.click(),
    ]);
    const firstVisitUrl = doctor.url();

    await doctor.getByLabel("Symptoms / Chief Complaint").fill("Tiredness, needs blood count");
    await doctor.getByRole("button", { name: /^Search ICD-10$/ }).click();
    await doctor.getByPlaceholder("Search ICD-10").fill("fever");
    const diagnosis = doctor.getByRole("option").first();
    await diagnosis.waitFor({ timeout: 20_000 });
    await diagnosis.click();

    await doctor.getByRole("button", { name: "Add Test" }).click();
    await doctor.getByRole("button", { name: "Test name" }).first().click();
    await doctor.getByPlaceholder("Select or type a test").fill(TEST_NAME);
    // Either the directory entry or the "use what I typed" row -- both order
    // the same test; the directory does not have to know it yet.
    await doctor.getByRole("option").first().click();

    await doctor.getByLabel("Follow-up").click();
    await doctor.getByRole("option", { name: "After report" }).click();

    await doctor.locator("#consultation-fee").fill("300");
    await doctor.getByRole("button", { name: "Complete Consultation" }).click();
    await expect(doctor.getByText(/completed/i).first()).toBeVisible({ timeout: 30_000 });

    // === RECEPTION: the ordered test is waiting for a file ================
    await reception.goto("/reports");
    const pendingRow = reception.getByRole("row").filter({ hasText: patientName }).first();
    await pendingRow.waitFor({ timeout: 30_000 });
    await expect(pendingRow, "the doctor's order is listed as awaiting a file").toContainText(TEST_NAME);
    await pendingRow.getByRole("button", { name: "Upload Report" }).click();

    const uploadDialog = reception.getByRole("dialog");
    await uploadDialog.getByLabel("Report name").fill(`${TEST_NAME} result`);
    await uploadDialog.getByLabel("Category").click();
    await reception.getByRole("option").first().click();
    // A real file, so the size/type validation and private storage path run.
    await uploadDialog.getByLabel("File").setInputFiles({
      name: "cbc-result.png",
      mimeType: "image/png",
      // Smallest valid PNG: an 1x1 transparent pixel.
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    });
    await uploadDialog.getByRole("button", { name: "Upload Privately" }).click();
    await expect(reception.getByRole("dialog")).toHaveCount(0, { timeout: 60_000 });

    // The report is on record and reachable for this patient.
    await reception.goto(`/reports?q=${encodeURIComponent(patientName)}`);
    await expect(
      reception.getByRole("row").filter({ hasText: `${TEST_NAME} result` }).first(),
      "the uploaded report is listed",
    ).toBeVisible({ timeout: 30_000 });

    // === RECEPTION: the follow-up the doctor asked for is now due =========
    await reception.goto("/reception/follow-ups");
    const followUpRow = reception.getByRole("row").filter({ hasText: patientName }).first();
    await followUpRow.waitFor({ timeout: 30_000 });
    await expect(followUpRow, "it is flagged as an after-report follow-up").toContainText(/after report/i);
    await followUpRow.getByRole("button", { name: "Create Follow-up" }).click();
    const followUpDialog = reception.getByRole("dialog");
    // The consultant sets the follow-up fee later; reception collects nothing.
    await expect(followUpDialog).toContainText(/consultant sets the follow-up fee/i);
    await followUpDialog.getByRole("button", { name: "Create Follow-up" }).click();

    // A NEW visit with its OWN token -- not a reopened visit 1 (AGENTS.md 27).
    // Follow-up creation hands reception straight to that record, rather than
    // refreshing the follow-up list and hiding the confirmation they need.
    await expect(reception).toHaveURL(/\/visits\/[0-9a-f-]{36}/, { timeout: 30_000 });
    const secondTokenHeading = reception.getByRole("heading", { name: /^Token #\d+/ });
    await expect(secondTokenHeading).toBeVisible();
    const secondToken = (await secondTokenHeading.innerText()).replace(/\D/g, "");
    expect(secondToken, "the follow-up gets its own token").not.toBe(firstToken);

    // === The original visit is untouched ==================================
    await doctor.goto(firstVisitUrl);
    await expect(doctor.locator("body"), "visit 1 finishes streaming with its token").toContainText(firstToken);
    await expect(doctor.locator("body"), "visit 1 stays completed rather than reopened").toContainText(/completed/i);

    // === DOCTOR: the follow-up is on their queue with its history =========
    await doctor.goto("/doctor/follow-ups");
    await expect(
      doctor.getByRole("row").filter({ hasText: patientName }).first(),
      "the doctor sees the follow-up they asked for",
    ).toBeVisible({ timeout: 30_000 });

    for (const page of [doctor, reception, op]) await page.close();
  });
});
