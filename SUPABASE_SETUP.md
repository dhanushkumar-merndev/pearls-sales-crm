# Supabase production setup

Use a dedicated Supabase project for production. Do not reuse the local or E2E project because those workflows intentionally create and modify hospital records.

## 1. Link and migrate

Install dependencies, authenticate the Supabase CLI, and link the exact production project:

```bash
pnpm install --frozen-lockfile
pnpm exec supabase login
pnpm exec supabase link --project-ref <production-project-ref>
pnpm db:push
```

Review the project ref printed by the CLI before confirming. Database migrations are the source of truth; do not paste migration files manually into the SQL editor. The SNOMED RF2 import is separate because the licensed release is not committed to Git.

## 2. Configure Auth

In Supabase Dashboard → Authentication:

- Disable public user sign-up.
- Set the Site URL to the clinic's final HTTPS application origin.
- Add only the required HTTPS redirect URLs. Do not leave wildcard preview URLs enabled for production.
- Keep leaked-password protection and email confirmation settings aligned with the hospital's account policy.

The application uses email/password authentication. Admin-created accounts are linked to `public.profiles`; hiding pages in the UI is not the security boundary—database RLS remains enabled.

## 3. Create the first admin

The bootstrap command refuses to run after any admin profile exists. Put the values in your current shell or a temporary, access-controlled environment file; do not pass the password as a command argument.

```bash
export FIRST_ADMIN_NAME='Hospital Administrator'
export FIRST_ADMIN_EMAIL='admin@example.com'
read -rsp 'First admin password: ' FIRST_ADMIN_PASSWORD && echo
export FIRST_ADMIN_PASSWORD
pnpm db:create-first-admin
unset FIRST_ADMIN_NAME FIRST_ADMIN_EMAIL FIRST_ADMIN_PASSWORD
```

The command requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the environment. It confirms the email, explicitly provisions and verifies the active admin profile through the server-only client, and writes an audit entry. Alternatively use `node scripts/create-first-admin.mjs --generate-password` with the name/email set; it saves the generated password in private `.env.admin-bootstrap` without printing it. Afterward, create all other staff from Admin → Users/Doctors. Never use `scripts/bootstrap-fresh-database.mjs` or demo seed scripts against production; they create test accounts/data.

## 4. Verify private storage

Migrations create the required storage policies. In Dashboard → Storage, verify `patient-documents` and `hospital-exports` are private. Do not make either bucket public. Patient files must be accessed through authenticated/signed application flows.

## 5. SNOMED CT

After the terminology migration is applied, import only the hospital's lawfully obtained official RF2 release. Follow the command and licensing notes in [README.md](README.md#snomed-ct-terminology). Store the original ZIP privately as the recovery source; do not commit it or copy it into the application image.

## 6. Final checks

Run `pnpm deploy:check` with the production environment loaded. Then confirm:

- public sign-up is disabled;
- every staff member has an individual account and correct role;
- the service-role key exists only in the server runtime;
- RLS and database authorization tests have passed;
- automated backups and point-in-time recovery meet the hospital's retention policy.
