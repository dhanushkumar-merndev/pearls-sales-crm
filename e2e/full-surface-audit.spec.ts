import { expect, test, type Page } from "@playwright/test";
import { credentialsConfigured, missingCredentials, signIn, type Role } from "./support/auth";
import { lookupFixtureIds, type FixtureIds } from "./support/fixtures";

test.skip(!credentialsConfigured, missingCredentials);
// Six simultaneous role crawls can saturate a development server and turn a
// capacity artifact into random navigation failures. The production surface
// is still fully covered, one authenticated role at a time.
test.describe.configure({ mode: "serial" });

/**
 * Every role against every page, every print document and every API route.
 *
 * Feature-by-feature testing kept missing whole-surface breakage -- a print
 * route 404ing because an RPC was never deployed, a page erroring only for one
 * role. This walks the entire surface for each role and reports everything at
 * once instead of failing on the first problem.
 */
/**
 * Record-scoped routes name the entity they need. The id is filled in at run
 * time; a route whose entity does not exist in this database is reported as
 * uncovered rather than counted as a 404, because "the clinic has no
 * prescription yet" is not the print route being broken.
 */
type Entity = keyof FixtureIds;

const PAGES: Array<{ path: string; roles: Role[]; entity?: Entity; suffix?: string }> = [
  { path: "/dashboard", roles: ["admin", "reception", "doctor", "op", "pharmacy"] },
  { path: "/notifications", roles: ["admin", "reception", "doctor", "op", "pharmacy"] },
  { path: "/admin/analytics", roles: ["admin"] },
  { path: "/admin/clinical-directory", roles: ["admin"] },
  { path: "/admin/clinical-directory/import", roles: ["admin"] },
  { path: "/admin/doctors", roles: ["admin"] },
  { path: "/admin/exports", roles: ["admin"] },
  { path: "/admin/masters", roles: ["admin"] },
  { path: "/admin/settings", roles: ["admin"] },
  { path: "/admin/users", roles: ["admin"] },
  { path: "/audit", roles: ["admin"] },
  { path: "/leads", roles: ["admin", "sales_executive"] },
  { path: "/leads/follow-ups", roles: ["admin", "sales_executive"] },
  { path: "/leads/booked", roles: ["admin", "sales_executive"] },
  { path: "/admin/integrations/meta", roles: ["admin"] },
  { path: "/reception/lead-appointments", roles: ["admin", "reception"] },
  { path: "/patients", roles: ["admin", "reception", "doctor", "op"] },
  { path: "/patients/", entity: "patient", suffix: "", roles: ["admin", "reception", "doctor", "op"] },
  { path: "/patients/import", roles: ["admin", "reception"] },
  { path: "/reception", roles: ["admin", "reception"] },
  { path: "/reception/follow-ups", roles: ["admin", "reception"] },
  { path: "/reception/payments", roles: ["admin", "reception"] },
  { path: "/op", roles: ["admin", "op"] },
  { path: "/op/assist", roles: ["admin", "op"] },
  { path: "/doctor", roles: ["admin", "doctor"] },
  { path: "/doctor/follow-ups", roles: ["admin", "doctor"] },
  { path: "/drug-stock", roles: ["admin", "reception", "doctor", "op"] },
  { path: "/pharmacy", roles: ["admin", "pharmacy"] },
  { path: "/pharmacy/import", roles: ["admin", "pharmacy"] },
  { path: "/pharmacy/inventory", roles: ["admin", "pharmacy"] },
  { path: "/pharmacy/medicines", roles: ["admin", "pharmacy"] },
  { path: "/pharmacy/sales", roles: ["admin", "pharmacy"] },
  { path: "/pharmacy/stock", roles: ["admin", "pharmacy"] },
  { path: "/reports", roles: ["admin", "reception", "op", "doctor"] },
  { path: "/visits/", entity: "visit", suffix: "", roles: ["admin", "reception", "doctor", "pharmacy"] },
  // Print documents: reachable by whoever has a button for them.
  { path: "/print/token/", entity: "visit", suffix: "", roles: ["admin", "reception"] },
  { path: "/print/prescription/", entity: "prescription", suffix: "", roles: ["admin", "pharmacy"] },
  { path: "/print/outside-purchase/", entity: "prescription", suffix: "", roles: ["admin", "pharmacy"] },
  { path: "/print/receipt/", entity: "sale", suffix: "", roles: ["admin", "pharmacy", "reception"] },
  { path: "/print/procedure-bill/", entity: "procedureSale", suffix: "", roles: ["admin", "pharmacy"] },
];

// `restricted: true` means a role outside the list must be refused (403), not
// merely unable to see rows. The reference lookups are deliberately open to
// any signed-in staff member -- a locality list or an allergy name is not
// patient data -- so for those the audit only insists on "not a 5xx".
const APIS: Array<{ path: string; roles: Role[]; restricted?: boolean }> = [
  { path: "/api/live/version", roles: ["admin", "reception", "doctor", "op", "pharmacy"] },
  { path: "/api/notifications?scope=unread&page=1&pageSize=10", roles: ["admin", "reception", "doctor", "op", "pharmacy"] },
  // The metric RPC enforces its own (stricter, money-aware) role guard.
  { path: "/api/dashboard/metric?metric=today_visits", roles: ["admin"], restricted: true },
  { path: "/api/search/patients?q=a", roles: ["admin", "reception", "doctor", "op", "pharmacy"] },
  { path: "/api/search/medicines?q=pa", roles: ["admin", "reception", "doctor", "pharmacy", "op"], restricted: true },
  { path: "/api/search/clinical-terms?q=fev", roles: ["admin", "reception", "doctor", "pharmacy"], restricted: true },
  { path: "/api/search/clinical-terms?type=diagnosis&codeSystem=SNOMED-CT&q=fever", roles: ["admin", "doctor", "pharmacy"], restricted: true },
  // Geoapify address autocomplete: answers 503 with no API key configured,
  // which is a deployment setting rather than a fault, so it is not asserted
  // as available -- only as never a 5xx for a role that should be refused.
  { path: "/api/search/locations?q=che", roles: [] },
  { path: "/api/search/allergies?q=pen", roles: ["admin", "reception", "doctor", "op", "pharmacy"] },
  // Restricted: these carry patient-identifying counter queues and exports.
  { path: "/api/search/op-visits-today?q=a", roles: ["admin", "pharmacy"], restricted: true },
  { path: "/api/patients/import/template", roles: ["admin", "reception"], restricted: true },
  { path: "/api/pharmacy/import/template", roles: ["admin", "pharmacy"], restricted: true },
  { path: "/api/admin/clinical/import/template", roles: ["admin"], restricted: true },
];

const ROLES: Role[] = ["admin", "reception", "doctor", "op", "pharmacy", "sales_executive"];

async function auditRole(page: Page, role: Role, fixtures: FixtureIds) {
  const failures: string[] = [];
  const uncovered: string[] = [];
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // Browser-level noise that is not the application failing.
    if (/favicon|manifest|Download the React DevTools/i.test(text)) return;
    consoleErrors.push(text.slice(0, 200));
  });

  await signIn(page, role);

  for (const entry of PAGES) {
    if (!entry.roles.includes(role)) continue;
    let path = entry.path;
    if (entry.entity) {
      const id = fixtures[entry.entity];
      if (!id) {
        uncovered.push(`${entry.path}<${entry.entity}> -- no ${entry.entity} exists`);
        continue;
      }
      path = `${entry.path}${id}${entry.suffix ?? ""}`;
    }
    consoleErrors.length = 0;
    const response = await page.goto(path, { waitUntil: "domcontentloaded" });
    const status = response?.status() ?? 0;
    if (status !== 200) {
      failures.push(`${path} -> HTTP ${status}`);
      continue;
    }
    if (/forbidden=1/.test(page.url())) {
      failures.push(`${path} -> redirected to forbidden`);
      continue;
    }
    const body = await page.locator("body").innerText().catch(() => "");
    // Next's own 404 copy is deliberately NOT treated as a failure here: a
    // streamed page that calls notFound() after the shell has flushed answers
    // 200 with that body, which is how RLS correctly refuses a record.
    if (/We could not load this page|Application error/i.test(body))
      failures.push(`${path} -> error boundary rendered`);
    if (/You're offline|This page hasn't been saved yet/i.test(body))
      failures.push(`${path} -> offline fallback rendered`);
    if (/could not be found/i.test(body))
      failures.push(`${path} -> rendered Next 404 body`);
    if (consoleErrors.length)
      failures.push(`${path} -> console: ${consoleErrors[0]}`);
  }

  for (const api of APIS) {
    const allowed = api.roles.includes(role);
    // Playwright's request context shares this page's authenticated cookies but
    // is not intercepted by a browser service worker, so this measures the API
    // route itself instead of CacheStorage behavior.
    const result = (await page.request.get(api.path)).status();
    if (allowed && result >= 400) {
      failures.push(`${api.path} -> HTTP ${result}`);
    } else if (!allowed && api.restricted && result !== 403) {
      // Refused, and refused as 403: a thrown guard used to surface as a 500,
      // which reads as an outage rather than a permission decision.
      failures.push(`${api.path} -> expected 403 for ${role}, got ${result}`);
    } else if (!allowed && result >= 500 && result !== 503) {
      failures.push(`${api.path} -> HTTP ${result}`);
    }
  }
  return { failures, uncovered };
}

let fixtures: FixtureIds = {};
test.beforeAll(async () => {
  fixtures = await lookupFixtureIds();
});

for (const role of ROLES) {
  test(`${role}: every page, print and API responds`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Surface audit runs once, on desktop.");
    test.setTimeout(300_000);
    const { failures, uncovered } = await auditRole(page, role, fixtures);
    // Visible in the report rather than silent: a database with no IP tickets
    // genuinely leaves the IP print routes untested, and that should be read,
    // not discovered later.
    if (uncovered.length) console.log(`${role}: ${uncovered.length} route(s) not covered\n  ${uncovered.join("\n  ")}`);
    // Report the whole list, not just the first one.
    expect(failures, `${role} failures:\n${failures.join("\n")}`).toEqual([]);
  });
}
