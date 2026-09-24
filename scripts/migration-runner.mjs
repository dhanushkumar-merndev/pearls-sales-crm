import { readFileSync } from "node:fs";
import { basename } from "node:path";
import pg from "pg";

export function migrationBody(sql) {
  // Historical files wrap themselves in BEGIN/COMMIT. The runner owns the
  // transaction so schema changes and migration history commit together.
  const start = sql.match(/^(?:(?:\s+)|(?:--[^\n]*(?:\n|$)))*(begin|start transaction)\s*;/i);
  const end = sql.match(/\bcommit\s*;\s*$/i);
  if (start && end) return sql.slice(start[0].length, end.index);
  return sql;
}

export function migrationParts(sql) {
  const boundary = sql.match(/^commit;\s*\nbegin;\s*$/im);
  if (!boundary) return { prelude: null, body: migrationBody(sql) };
  const prelude = sql.slice(0, boundary.index);
  const statements = prelude.replace(/--[^\n]*/g, "").trim();
  if (!/^alter type public\.\w+ add value if not exists '[a-z_]+';$/i.test(statements)) {
    throw new Error("Unsupported internal transaction boundary in migration.");
  }
  // These two legacy enum migrations deliberately commit the new value before
  // using it. The idempotent enum prelude is safe to rerun after a failure.
  const body = sql.slice(boundary.index + boundary[0].length).replace(/\bcommit;\s*$/i, "");
  return { prelude, body };
}

export async function migrationClient() {
  try { process.loadEnvFile(".env"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const ref = process.env.SUPABASE_PROJECT_ID;
  const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const password = process.env.SUPABASE_DB_PASSWORD;
  const poolerHost = process.env.SUPABASE_DB_POOLER_HOST || "aws-0-ap-south-1.pooler.supabase.com";
  if (!/^[a-z0-9.-]+$/i.test(poolerHost)) throw new Error("Invalid database pooler hostname.");
  if (!ref || !password || !apiUrl) throw new Error("Set the project ID, API URL and database password before applying migrations.");
  if (new URL(apiUrl).hostname !== `${ref}.supabase.co`) throw new Error("Supabase project ID and API URL do not match.");
  const client = new pg.Client({
    connectionString: `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${poolerHost}:5432/postgres`,
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000,
  });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock(hashtext('pearl_schema_migrations'))");
    const { rows } = await client.query("select to_regclass('supabase_migrations.schema_migrations') as history");
    if (!rows[0].history) {
      const existing = await client.query("select count(*)::int as n from pg_tables where schemaname = 'public'");
      if (existing.rows[0].n) throw new Error("Application tables exist without migration history. Baseline them before applying migrations.");
      await client.query("create schema if not exists supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text)");
    }
    return client;
  } catch (error) { await client.end(); throw error; }
}

export async function applyMigration(client, file) {
  const name = basename(file);
  const version = name.split("_")[0];
  if (!/^\d{14}_.*\.sql$/.test(name)) throw new Error("Invalid migration filename.");
  const { rows } = await client.query("select version from supabase_migrations.schema_migrations where version = $1", [version]);
  if (rows.length) return false;
  const { prelude, body } = migrationParts(readFileSync(file, "utf8"));
  if (prelude) await client.query(prelude);
  await client.query("begin");
  try {
    await client.query(body);
    await client.query("insert into supabase_migrations.schema_migrations(version,name) values ($1,$2)", [version, name.replace(/^\d+_/, "").replace(/\.sql$/, "")]);
    await client.query("notify pgrst, 'reload schema'");
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
