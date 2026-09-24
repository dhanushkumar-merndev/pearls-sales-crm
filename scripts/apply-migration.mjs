/**
 * Applies one migration file through the connection pooler and records it in
 * supabase_migrations.schema_migrations, so the CLI still sees a consistent
 * history.
 *
 * `supabase db push` needs IPv6 to reach the database directly, which this
 * network does not have; the pooler is IPv4 and works.
 *
 *   node scripts/apply-migration.mjs supabase/migrations/<file>.sql
 */
import { applyMigration, migrationClient } from "./migration-runner.mjs";

const file = process.argv[2];
if (!file) throw new Error("Pass the migration file path.");
const client = await migrationClient();
try {
  console.log(await applyMigration(client, file) ? "Migration applied." : "Migration already applied.");
} finally {
  await client.end();
}
