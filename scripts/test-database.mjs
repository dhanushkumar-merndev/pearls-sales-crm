/** pgTAP tests use transaction-scoped fixtures and always roll back. */
import { readdirSync, readFileSync } from "node:fs";
import { migrationClient } from "./migration-runner.mjs";
const client = await migrationClient();
let failures = 0;
try {
  await client.query("create extension if not exists pgtap with schema extensions");
  await client.query("set search_path = public, extensions");
  const selected = process.argv.slice(2);
  const files = readdirSync("supabase/tests").filter((file) => file.endsWith(".test.sql") && (!selected.length || selected.includes(file))).sort();
  for (const file of files) {
    try {
      const result = await client.query(readFileSync(`supabase/tests/${file}`, "utf8"));
      const lines = (Array.isArray(result) ? result : [result]).flatMap((r) => r.rows.flatMap((row) => Object.values(row).filter((value) => typeof value === "string")));
      const tests = lines.filter((line) => /^(?:not )?ok \d+/m.test(line));
      const failed = lines.filter((line) => /^not ok|^# (?:Looks like|No tests)/m.test(line));
      failures += failed.length;
      console.log(`${file}: ${tests.length} assertions, ${failed.length} failures`);
      for (const line of failed) console.error(line);
    } catch (error) {
      failures++;
      console.error(`${file}: ${error.code ?? "error"} ${error.message}`);
    } finally { await client.query("rollback"); }
  }
} finally { await client.end(); }
if (failures) process.exitCode = 1;
