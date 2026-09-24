import { expect, test } from "@playwright/test";
import { credentialsConfigured, missingCredentials, signIn } from "./support/auth";
import { lookupMedicineByDosageForm, lookupOpenVisit } from "./support/fixtures";

test.skip(!credentialsConfigured, missingCredentials);

// The dose box used to prompt "1 tablet" whatever the medicine was, which
// reads as an instruction on a row that says Calpol Syrup.
test("the dose prompt follows the medicine's dosage form", async ({ page }) => {
  // A visit that is still open enough to prescribe on. The comment here used
  // to claim this was looked up while a literal id sat on the next line.
  const visitId = await lookupOpenVisit();
  const [syrup, injection] = await Promise.all([
    lookupMedicineByDosageForm("syrup"),
    lookupMedicineByDosageForm("injection"),
  ]);
  if (!visitId) {
    test.skip(true, "This database has no open visit.");
    return;
  }
  if (!syrup || !injection) {
    test.skip(true, "This database needs one active syrup and injection medicine.");
    return;
  }
  await signIn(page, "admin");
  const response = await page.goto(`/visits/${visitId}`);
  const addMedicine = page.getByRole("button", { name: /Add Medicine/i });
  test.skip(
    response?.status() !== 200 || !(await addMedicine.count()),
    "No open visit to prescribe on in this database.",
  );
  await addMedicine.click();
  const dose = page.getByRole("textbox", { name: /^Dose/ }).last();
  await expect(dose).toHaveAttribute("placeholder", "Dose");

  await page.getByRole("combobox", { name: /Search medicine/i }).last().click();
  await page.getByPlaceholder("Type at least 2 letters").fill(syrup);
  await page.getByRole("option").filter({ hasText: syrup }).first().click();
  await expect(dose).toHaveAttribute("placeholder", "5 ml");

  await page.getByRole("combobox", { name: syrup }).click();
  await page.getByPlaceholder("Type at least 2 letters").fill(injection);
  await page.getByRole("option").filter({ hasText: injection }).first().click();
  await expect(dose).toHaveAttribute("placeholder", "1 ml");
  // An injection is not given "Oral": picking it sets the route it is
  // actually given by.
  await expect(page.getByLabel("Route").last()).toHaveText(/IV/);
});
