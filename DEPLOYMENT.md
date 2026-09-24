# Production deployment

The supported targets are Vercel and any container platform that can run the included standalone Docker image. Supabase remains the managed Auth, PostgreSQL, and private-storage backend.

## Release order

1. Back up the production database and confirm the target Supabase project ref.
2. Apply migrations with `pnpm exec supabase link --project-ref <ref>` and `pnpm db:push`.
3. Run `pnpm deploy:check` with the intended environment.
4. Build and deploy the immutable application release.
5. Check `GET /api/health`, sign in, and exercise one read-only workflow for each role.

Do not run migrations or terminology imports automatically when an app container starts. Multiple replicas can start concurrently, and database changes need an explicit, reviewable release step.

## Required environment

The canonical list is [.env.example](.env.example). These values are required by the web runtime:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_APP_URL
SUPABASE_SERVICE_ROLE_KEY
APP_TIMEZONE
PATIENT_DOCUMENT_MAX_BYTES
EXPORT_RETENTION_DAYS
```

`NEXT_PUBLIC_*` values are embedded into browser JavaScript during `next build`; set the same values during build and runtime. `SUPABASE_SERVICE_ROLE_KEY` is a runtime secret and must never be placed in a public variable, Docker build argument, repository, client log, or monitoring label.

The `postbuild` step removes `.env` and `.env.production` from the generated standalone directory. Do not disable it when packaging a local build; inject all server secrets through the deployment platform at runtime.

Set `DEPLOYMENT_VERSION` to the immutable Git commit/release ID. When running multiple self-hosted replicas, generate `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` once with `openssl rand -base64 32` and provide the same value to every replica.

## Vercel

1. Import the repository as a Next.js project.
2. Select pnpm and Node.js 22 or newer.
3. Add all required variables to the Production environment. Keep E2E, database-password, and first-admin variables out of the application runtime.
4. Set `DEPLOYMENT_VERSION` from the release identifier if desired; otherwise the config uses Vercel's Git commit SHA.
5. Deploy only after the matching Supabase migrations succeed.

Use a protected staging project for preview deployments. Never point untrusted preview builds at the production Supabase project because public project identifiers are embedded at build time.

## Docker / container platform

Build public values into the client bundle. No secret is passed to this command:

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key> \
  --build-arg NEXT_PUBLIC_APP_URL=https://<application-origin> \
  --build-arg DEPLOYMENT_VERSION=<git-commit> \
  -t pearl-clinic:<git-commit> .
```

Create a runtime environment file outside the repository and start the image:

```bash
docker run --rm \
  --env-file /secure/path/meenakshi-production.env \
  -p 3000:3000 \
  meenakshi-hms:<git-commit>
```

The image runs as the unprivileged `node` user and includes a health check. Terminate TLS at the load balancer/reverse proxy, forward the original host/protocol headers, enforce request-rate limits at the edge, and restrict direct access to port 3000.

## Health and observability

`GET /api/health` is unauthenticated, bypasses Supabase session refresh, and returns only liveness plus the optional deployment ID. It does not test the database. The existing authenticated live-version check verifies the operational database signature after staff sign-in.

Send server logs to access-controlled centralized storage. Never log request cookies, authorization headers, service keys, patient documents, diagnoses, or prescription bodies. Add uptime monitoring to the health endpoint and alerts for 5xx rates, authentication failures, database saturation, storage failures, low stock, and failed exports.

## Rollback and recovery

- Keep every application image/release addressable by immutable commit ID.
- Roll back the application to its previous image if the schema remains backward compatible.
- Use a reviewed forward migration for schema corrections; never rewrite a migration already applied to production.
- Test database restore and private-storage recovery before go-live, then on the hospital's chosen schedule.
- Keep the official SNOMED release ZIP privately so terminology can be rebuilt.

## Go-live checklist

- `pnpm verify` and `pnpm audit --prod` pass.
- Migrations and Supabase authorization tests pass against staging.
- Public sign-up is disabled and the first admin is created securely.
- Production buckets are private; signed/authenticated file access works.
- Hospital name, address, phone, doctors, charges, and print settings are correct.
- Token, prescription, receipt, and procedure bill print correctly on the clinic's real printers.
- Desktop and mobile workflows are checked at 375, 430, 768, 1024, and 1440 px.
- Backups, restore testing, HTTPS, DNS, monitoring, alerts, and rollback ownership are documented.

Run Playwright E2E only against staging: it creates patients, visits, payments, consultations, stock movements, enquiries and test staff.

Meta Lead Ads additionally requires the server-only `INTEGRATION_ENCRYPTION_KEY` and `META_GRAPH_API_VERSION`. Follow [META_SETUP.md](META_SETUP.md), including a live test delivery from the clinic's own Meta account.
