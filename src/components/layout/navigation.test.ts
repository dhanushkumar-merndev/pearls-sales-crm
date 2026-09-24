import { describe, expect, it } from "vitest";
import { getActiveNavigationHref, ROLE_NAVIGATION } from "./navigation";
import { canAccessRoute } from "@/lib/auth/permissions";
import { APP_ROLES } from "@/types/hospital";

describe("getActiveNavigationHref", () => {
  it("chooses the most specific matching reception link", () => {
    expect(
      getActiveNavigationHref(
        ROLE_NAVIGATION.reception,
        "/reception/follow-ups",
      ),
    ).toBe("/reception/follow-ups");
  });

  it("keeps a module root active for an unlisted detail page", () => {
    expect(
      getActiveNavigationHref(ROLE_NAVIGATION.sales_executive, "/leads/lead-id"),
    ).toBe("/leads");
  });

  it("prefers the most specific leads destination", () => {
    expect(
      getActiveNavigationHref(ROLE_NAVIGATION.sales_executive, "/leads/follow-ups"),
    ).toBe("/leads/follow-ups");
  });

  it("keeps the OP queue out of the reception workspace", () => {
    const destinations = ROLE_NAVIGATION.reception.map((item) => item.href);
    expect(destinations).not.toContain("/op");
    expect(destinations).toEqual(
      expect.arrayContaining(["/reception", "/reception/lead-appointments", "/reports", "/drug-stock"]),
    );
  });

  it("gives the OP desk its queue, assist board and reports", () => {
    const destinations = ROLE_NAVIGATION.op.map((item) => item.href);
    expect(destinations).toEqual(
      expect.arrayContaining(["/op", "/op/assist", "/reports", "/drug-stock"]),
    );
  });

  it("gives sales executives only lead destinations", () => {
    const destinations = ROLE_NAVIGATION.sales_executive.map((item) => item.href);
    expect(destinations.every((href) => href === "/dashboard" || href.startsWith("/leads"))).toBe(true);
  });

  it("gives admin the medicine library in the Administration group", () => {
    const entry = ROLE_NAVIGATION.admin.find(
      (item) => item.href === "/pharmacy/medicines",
    );
    expect(entry?.title).toBe("Medicine Directory");
    expect(entry?.group).toBe("Administration");
  });

  it("keeps the medicine library active rather than the pharmacy root", () => {
    expect(
      getActiveNavigationHref(ROLE_NAVIGATION.admin, "/pharmacy/medicines"),
    ).toBe("/pharmacy/medicines");
  });

  it("does not treat dashboard as a parent route", () => {
    expect(
      getActiveNavigationHref(
        ROLE_NAVIGATION.reception,
        "/dashboard/example",
      ),
    ).toBeUndefined();
  });
});

/**
 * The sidebar and the route guard are two separate lists, and they drift: a
 * destination added to one role's navigation that its guard does not allow
 * sends that person to "forbidden" from their own sidebar, and a page a role
 * can reach but is never shown is a feature nobody can find.
 *
 * AGENTS.md 69 -- hiding a link is not security, the guard is -- so this does
 * not test authorization. It tests that the menu tells the truth about it.
 */
describe("navigation matches the route guard", () => {
  it("never offers a role a destination its guard would refuse", () => {
    const refused: string[] = [];
    for (const role of APP_ROLES) {
      for (const item of ROLE_NAVIGATION[role]) {
        if (!canAccessRoute(role, item.href)) refused.push(`${role} -> ${item.href} (${item.title})`);
      }
    }
    expect(refused, `Sidebar entries the guard rejects:\n${refused.join("\n")}`).toEqual([]);
  });

  it("offers every role a fallback destination its guard allows", () => {
    const refused: string[] = [];
    for (const role of APP_ROLES) {
      for (const item of ROLE_NAVIGATION[role]) {
        for (const prefix of item.fallbackPrefixes ?? []) {
          if (!canAccessRoute(role, prefix)) refused.push(`${role} -> ${prefix}`);
        }
      }
    }
    expect(refused).toEqual([]);
  });

  it("keeps pharmacy stock management out of every clinical sidebar", () => {
    for (const role of ["reception", "doctor", "op"] as const) {
      const destinations = ROLE_NAVIGATION[role].map((item) => item.href);
      expect(destinations, role).not.toContain("/pharmacy/stock");
      expect(destinations, role).not.toContain("/pharmacy/medicines");
      // What they get instead: availability only, no batches or prices.
      expect(destinations, role).toContain("/drug-stock");
    }
  });

  it("gives the medicine library to exactly the roles allowed to open it", () => {
    const shown = APP_ROLES.filter((role) =>
      ROLE_NAVIGATION[role].some((item) => item.href === "/pharmacy/medicines"),
    );
    expect(shown).toEqual(["admin", "pharmacy"]);
    for (const role of APP_ROLES)
      expect(canAccessRoute(role, "/pharmacy/medicines"), role).toBe(shown.includes(role));
  });
});
