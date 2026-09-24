import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { credentialsConfigured, emailFor, missingCredentials, signIn } from "./support/auth";

test("pharmacy stocks consumables, bills a procedure and prints the exact total", async ({ page }, info) => {
  test.skip(!credentialsConfigured, missingCredentials);
  test.skip(info.project.name !== "desktop", "Create the procedure once in the shared database.");
  test.setTimeout(180_000);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Procedure verification needs Supabase test fixture credentials.");
  const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: profile, error: profileError } = await db.from("profiles")
    .select("id").eq("email", emailFor("pharmacy")).single();
  if (profileError || !profile) throw new Error("The pharmacy test profile must exist.");

  const stamp = Date.now().toString().slice(-9);
  const patientName = `ZZ E2E Procedure Patient ${stamp}`;
  const itemName = `ZZ E2E Procedure Gauze ${stamp}`;
  const procedureName = `ZZ E2E Dressing ${stamp}`;
  const { data: patient, error: patientError } = await db.from("patients").insert({
    name: patientName,
    phone_normalized: `9${stamp}`,
    gender: "unknown",
    created_by: profile.id,
  }).select("id").single();
  if (patientError || !patient) throw new Error(`Procedure patient setup failed: ${patientError?.message}`);

  await signIn(page, "pharmacy");
  await page.goto("/pharmacy/inventory");
  await page.getByRole("button", { name: "Add Item", exact: true }).click();
  const stockDialog = page.getByRole("dialog");
  await stockDialog.getByLabel("Item name *", { exact: true }).fill(itemName);
  await stockDialog.getByLabel("Unit", { exact: true }).fill("piece");
  await stockDialog.getByLabel("Price (₹) *", { exact: true }).fill("12.50");
  await stockDialog.getByLabel("Opening quantity *", { exact: true }).fill("20");
  await stockDialog.getByLabel("Low stock alert at").fill("2");
  await stockDialog.getByRole("button", { name: "Save Item", exact: true }).click();
  await expect.poll(async () => {
    const { data, error } = await db.from("inventory_items").select("quantity").eq("name", itemName).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.quantity;
  }, { message: "the stock-in saves all 20 consumables", timeout: 30_000 }).toBe(20);
  await page.keyboard.press("Escape");

  // Search before billing also ensures this item is available beyond page 1.
  await page.goto(`/pharmacy/inventory?q=${encodeURIComponent(itemName)}`);
  const stockRow = page.getByRole("row").filter({ hasText: itemName });
  await expect(stockRow.getByRole("cell").nth(4)).toHaveText("20");
  await page.getByRole("button", { name: "New Procedure Bill", exact: true }).click();
  const bill = page.getByRole("dialog");
  await bill.getByRole("combobox", { name: "Search patient by phone or name" }).click();
  await page.getByPlaceholder("Type phone number or patient name").fill(patientName);
  await page.getByRole("option").filter({ hasText: patientName }).click();
  await bill.getByLabel("Procedure name *", { exact: true }).fill(procedureName);
  await bill.getByLabel("Procedure fee (₹)", { exact: true }).fill("350");
  await bill.getByRole("button", { name: "Add Item", exact: true }).click();
  const line = bill.getByRole("row").filter({ has: page.getByRole("button", { name: "Remove", exact: true }) });
  await line.getByRole("combobox").click();
  await page.getByRole("option").filter({ hasText: itemName }).click();
  await line.getByRole("spinbutton").fill("3");
  await expect(line.getByRole("cell").nth(3)).toHaveText("₹37.50");
  await expect(bill.getByText("₹387.50", { exact: true })).toBeVisible();
  await bill.getByRole("button", { name: "Create Bill", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bill created", exact: true })).toBeVisible({ timeout: 30_000 });

  const [receipt] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "Print Bill", exact: true }).click(),
  ]);
  await expect(receipt).toHaveURL(/\/print\/procedure-bill\/[0-9a-f-]{36}$/);
  const article = receipt.locator("article");
  await expect(article).toContainText(patientName);
  await expect(article).toContainText(procedureName);
  await expect(article).toContainText("PA-");
  const printedLine = article.getByRole("row").filter({ hasText: itemName });
  await expect(printedLine.getByRole("cell").nth(1)).toHaveText("3");
  await expect(printedLine.getByRole("cell").nth(2)).toHaveText("₹12.50");
  await expect(printedLine.getByRole("cell").nth(3)).toHaveText("₹37.50");
  await expect(article.locator("div").filter({ has: receipt.locator("dt").filter({ hasText: /^Total$/ }) }).locator("dd")).toHaveText("₹387.50");

  const saleId = receipt.url().split("/").pop()!;
  const { data: sales, error: saleError } = await db.from("procedure_sales")
    .select("id,procedure_fee_paise,items_total_paise,total_paise,payment_mode")
    .eq("patient_id", patient.id);
  expect(saleError).toBeNull();
  expect(sales).toEqual([{ id: saleId, procedure_fee_paise: 35000, items_total_paise: 3750, total_paise: 38750, payment_mode: "cash" }]);
  const { data: movements, error: movementError } = await db.from("inventory_stock_movements")
    .select("quantity_delta,quantity_before,quantity_after").eq("source_id", saleId);
  expect(movementError).toBeNull();
  expect(movements).toEqual([{ quantity_delta: -3, quantity_before: 20, quantity_after: 17 }]);

  // Reprinting must read the existing bill without charging or consuming again.
  await receipt.reload();
  await expect(receipt.locator("article")).toContainText("₹387.50");
  await page.goto(`/pharmacy/inventory?q=${encodeURIComponent(itemName)}`);
  await expect(page.getByRole("row").filter({ hasText: itemName }).getByRole("cell").nth(4)).toHaveText("17");
  await page.goto("/pharmacy/inventory?tab=bills");
  await expect(page.getByRole("row").filter({ hasText: procedureName })).toContainText("₹387.50");
  await receipt.close();
});
