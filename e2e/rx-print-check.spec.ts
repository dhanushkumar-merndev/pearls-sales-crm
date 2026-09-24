import { expect, test } from "@playwright/test";
import { credentialsConfigured, missingCredentials, signIn } from "./support/auth";
import { lookupPrescriptions } from "./support/fixtures";

test.skip(!credentialsConfigured, missingCredentials);

test("pharmacy can print an OP prescription", async ({ page }) => {
  const { op } = await lookupPrescriptions();
  const targets = [
    { label: "OP", id: op },
  ].filter((t): t is { label: string; id: string } => Boolean(t.id));
  test.skip(targets.length === 0, "This database has no prescriptions to print.");

  await signIn(page, "pharmacy");
  for (const { label, id } of targets) {
    const response = await page.goto(`/print/prescription/${id}`);
    expect(response?.status(), `${label} prescription ${id} prints`).toBe(200);
    await expect(page.getByText(/Prescription No/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Print Prescription/i })).toBeVisible();
  }
});
