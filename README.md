# Pearl Aesthetic & Wellness Clinic

Next.js 16, shadcn/ui, and Supabase clinic management with a leads CRM. Authentication is email/password only. Patients have internal UUIDs and visible PA- identifiers, with mobile numbers used for search. Payments are append-only offline records; pharmacy stock changes through transactional dispensing. Roles are admin, reception, OP, doctor, pharmacy, and sales executive. The inpatient module has been removed.

## Local setup

1. Install dependencies: `pnpm install`
2. Copy `.env.example` to `.env.local`.
3. Start Supabase: `pnpm db:start`
4. Copy the local URL, anon key, and service-role key printed by the CLI into `.env.local`.
5. Rebuild the database: `pnpm db:reset`
6. Create the first admin as described in [SUPABASE_SETUP.md](SUPABASE_SETUP.md).
7. Start the app: `pnpm dev`

Useful checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, or all four with `pnpm verify`. Local database tests run with `pnpm db:test`. For the hosted project configured in `.env`, `node scripts/test-database.mjs` runs pgTAP with transaction-scoped fixtures that roll back.

## Production deployment

The repository produces a Next.js standalone server and includes a non-root, health-checked Docker image. Run `pnpm deploy:check`, then follow [DEPLOYMENT.md](DEPLOYMENT.md) and [SUPABASE_SETUP.md](SUPABASE_SETUP.md). Apply database migrations as a separate release step; never place the service-role key in a build argument or public environment variable.

### Browser tests

`pnpm exec playwright install chromium` once, then `pnpm test:e2e`.

The suite signs in as real staff accounts, so it needs credentials in `.env`:

```
E2E_PASSWORD=            # optional shared password for test staff
E2E_ADMIN_EMAIL=         # set the real test admin email
E2E_DOCTOR_NAME=         # display name of the doctor the doctor account is linked to
```

Each role signs in as `<role>@meenakshihospital.com` unless `E2E_<ROLE>_EMAIL` overrides it. Without `E2E_PASSWORD` the authenticated specs skip rather than fail. Point the suite at an already-running dev server with `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3001 pnpm test:e2e`.

The specs write to whatever database `.env` points at: patients, enquiries, visits, consultations and dispensing. Use a dedicated test project. Each role accepts `E2E_<ROLE>_EMAIL` and `E2E_<ROLE>_PASSWORD`, including `OP` and `SALES_EXECUTIVE`. Keep QA credentials in a git-ignored local environment file.

Coverage includes reception → OP → doctor → pharmacy, sales enquiry → booking → reception arrival, six-role isolation, staff provisioning, print documents, and lead layouts at 375, 430, 768, 1024 and 1440 pixels. Missing fixture-dependent print routes are reported as uncovered.

## Leads and Meta setup

Sales executives work only their assigned enquiries; admin can assign and report on all leads. Reception sees booked appointments and creates the visit/token on arrival. OP owns vitals and has no financial workspace. See [META_SETUP.md](META_SETUP.md) for the server settings, encrypted page tokens, webhook and test delivery steps.

For a fresh hosted project, `node scripts/apply-all-migrations.mjs` validates the project ID against the URL, locks migration execution, and records each successful migration. It refuses to baseline an existing application schema without migration history. The pooler defaults to Mumbai and can be overridden with `SUPABASE_DB_POOLER_HOST`.

Create the first administrator with `FIRST_ADMIN_NAME`, `FIRST_ADMIN_EMAIL` and `node scripts/create-first-admin.mjs --generate-password`. Its generated password is saved to the private, git-ignored `.env.admin-bootstrap`; it is never printed. Store the password securely and rotate it after setup. Do not run the demo/bootstrap seed scripts on a working clinic database.

Hosted migrations use `supabase link --project-ref <ref>` followed by `pnpm db:push`. Never place a service-role key in a public variable.

## SNOMED CT terminology

SNOMED CT is not committed to this repository. It is licensed terminology and
must be obtained by the hospital from SNOMED International or its national
release centre. After applying migrations, import an extracted International
RF2 Snapshot package with:

```bash
pnpm db:import-snomed -- /absolute/path/to/SnomedCT_InternationalRF2_PRODUCTION_<date> \
  --project <SUPABASE_PROJECT_ID> --yes
```

Without `--yes`, the command is a dry run. It verifies the release and reports
counts without changing the database. A real import requires the project ref to
match `.env`, replaces the prior active terminology in one transaction, stores
the package version and licence statement, and rolls back completely on error.
Only current active English concepts, preferred terms and synonyms are retained;
RF2 Full history, OWL and relationship files stay outside the operational HMS.
The original release ZIP is the recovery copy and should be stored privately.
