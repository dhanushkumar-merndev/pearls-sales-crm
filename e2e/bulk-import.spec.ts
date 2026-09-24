import { expect, test } from "@playwright/test";
import { credentialsConfigured, missingCredentials, signIn } from "./support/auth";

/**
 * AGENTS.md 31B: a full-size file must upload, validate without freezing the
 * browser, preview, import in batches, and finish with accurate counts.
 *
 * The file is built in the page as a CSV blob and handed to the file input, so
 * this exercises the real parse -> validate -> chunked upload path.
 */
const ROWS = 10_000;

async function attachCsv(page: import("@playwright/test").Page, name: string, csv: string) {
  // setInputFiles is a programmatic event, so unlike a human click it is not
  // replayed while React is hydrating. Wait for the client upload control to
  // be ready before handing it a file.
  await expect(page.locator('[data-file-upload-ready="true"]')).toBeVisible();
  await page.setInputFiles('input[type="file"]', {
    name,
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8"),
  });
}

test.describe("bulk import", () => {
  test.skip(!credentialsConfigured, missingCredentials);

  test("validates a 10,000-row patient file and rejects the bad rows", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Runs once, on desktop.");
    test.setTimeout(240_000);
    await signIn(page, "reception");
    await page.goto("/patients/import");

    // 9,998 good rows, one bad phone, one duplicate phone.
    const base = 6_000_000_000 + Math.floor(Math.random() * 900_000_000);
    const lines = ["name,phone,gender,dob,blood_group,address,allergies,notes"];
    for (let index = 0; index < ROWS - 2; index += 1) {
      lines.push(`Bulk Patient ${index},${base + index},male,1990-01-01,O+,Ramanathapuram,,`);
    }
    lines.push(`Bad Phone Patient,12345,male,,,,,`);
    lines.push(`Duplicate Patient,${base},female,,,,,`);

    const started = Date.now();
    await attachCsv(page, "patients.csv", lines.join("\n"));

    await expect(page.getByText("Validation summary", { exact: false })).toBeVisible({ timeout: 120_000 });
    const parseSeconds = (Date.now() - started) / 1000;
    console.log(`parsed and validated ${ROWS} rows in ${parseSeconds.toFixed(1)}s`);

    // Counts are exact: two rows are rejected, the rest are importable.
    // Counts render in Indian digit grouping.
    await expect(page.getByText(ROWS.toLocaleString("en-IN"), { exact: true }).first()).toBeVisible();
    await expect(page.getByText((ROWS - 2).toLocaleString("en-IN"), { exact: true }).first()).toBeVisible();
    await expect(page.getByText("2", { exact: true }).first()).toBeVisible();

    // Invalid rows block the import and can be downloaded.
    await expect(page.getByRole("button", { name: /Download Error Rows/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Import .* Valid Rows/ })).toBeDisabled();

    // The browser is still responsive after validating 10,000 rows.
    await page.getByRole("button", { name: "Download Excel Template" }).hover();
  });

  test("imports a clean file in chunks and reports the count", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Runs once, on desktop.");
    test.setTimeout(240_000);
    await signIn(page, "reception");
    await page.goto("/patients/import");

    // Small enough to import quickly, large enough to cross a chunk boundary.
    const count = 600;
    const base = 7_000_000_000 + Math.floor(Math.random() * 900_000_000);
    const lines = ["name,phone,gender,dob,blood_group,address,allergies,notes"];
    for (let index = 0; index < count; index += 1) {
      lines.push(`Chunk Patient ${index},${base + index},female,,,,,`);
    }
    await attachCsv(page, "patients-small.csv", lines.join("\n"));

    await expect(page.getByRole("button", { name: `Import ${count} Valid Rows` })).toBeEnabled({ timeout: 60_000 });
    await page.getByRole("button", { name: `Import ${count} Valid Rows` }).click();
    await expect(page.getByText(`Imported ${count} rows.`)).toBeVisible({ timeout: 120_000 });

    // The patients are really there.
    await page.goto(`/patients?q=${base}`);
    await expect(page.getByRole("row").filter({ hasText: "Chunk Patient 0" })).toBeVisible({ timeout: 30_000 });
  });
});
