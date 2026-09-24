/**
 * Applies every migration in supabase/migrations, in order, to a fresh
 * database -- same mechanism as apply-migration.mjs (one at a time, over the
 * pooler, recorded into supabase_migrations.schema_migrations so the CLI's
 * history stays consistent), just looped instead of invoked per file.
 *
 * Stops at the first failure and reports exactly which file and how many
 * succeeded before it, rather than pushing on into a half-applied schema.
 *
 *   node scripts/apply-all-migrations.mjs
 */
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { applyMigration, migrationClient } from "./migration-runner.mjs";

const dir = "supabase/migrations";
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => join(dir, f));

const client = await migrationClient();
console.log(`Checking ${files.length} migrations for project ${process.env.SUPABASE_PROJECT_ID}...`);

let applied = 0;
let failed = false;
try {
  for (const file of files) {
    const name = basename(file);
    try {
      if (!await applyMigration(client, file)) continue;
      applied++;
      console.log(`  [${applied}/${files.length}] ${name}`);
    } catch (error) {
      console.error(`\nFAILED at ${name} (${applied} applied before this one; current schema transaction rolled back):`);
      console.error(`  ${error.message}`);
      failed = true;
      break;
    }
  }
  if (!failed) {
    await client.query("notify pgrst, 'reload schema'");
    console.log(`\nAll ${applied} migrations applied. Schema cache reload notified.`);
  }
} finally {
  await client.end();
}
if (failed) process.exit(1);
