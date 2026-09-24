import { describe, expect, it } from "vitest";
import { canAccessRoute, hasPermission } from "./permissions";
import { APP_ROLES } from "@/types/hospital";

describe("role authorization matrix", () => {
  it("allows only admins to manage users", () => {
    for (const role of APP_ROLES) expect(hasPermission(role, "manageUsers")).toBe(role === "admin");
  });
  it("allows only pharmacy and admin to dispense", () => {
    for (const role of APP_ROLES) expect(hasPermission(role, "dispense")).toBe(role === "admin" || role === "pharmacy");
  });
  it("isolates role routes", () => {
    expect(canAccessRoute("doctor", "/doctor")).toBe(true);
    expect(canAccessRoute("doctor", "/pharmacy")).toBe(false);
    expect(canAccessRoute("reception", "/admin/users")).toBe(false);
    expect(canAccessRoute("pharmacy", "/patients")).toBe(false);
  });

  it("keeps audit logs exclusive to administrators", () => {
    for (const role of APP_ROLES) {
      expect(canAccessRoute(role, "/audit"), `${role} audit access`).toBe(role === "admin");
    }
  });

  it("keeps the front desk and the OP desk separate", () => {
    expect(canAccessRoute("reception", "/reception")).toBe(true);
    expect(canAccessRoute("reception", "/op")).toBe(false);
    expect(hasPermission("reception", "createVisit")).toBe(true);
    expect(hasPermission("reception", "collectVisitPayment")).toBe(true);
    expect(hasPermission("reception", "recordVitals")).toBe(false);
    expect(hasPermission("reception", "uploadReport")).toBe(true);
  });

  it("gives OP the queue, vitals and reports but no money", () => {
    expect(canAccessRoute("op", "/op")).toBe(true);
    expect(canAccessRoute("op", "/op/assist")).toBe(true);
    expect(canAccessRoute("op", "/reports")).toBe(true);
    expect(canAccessRoute("op", "/drug-stock")).toBe(true);
    expect(canAccessRoute("op", "/reception/payments")).toBe(false);
    expect(hasPermission("op", "recordVitals")).toBe(true);
    expect(hasPermission("op", "uploadReport")).toBe(true);
    expect(hasPermission("op", "viewVisitFinance")).toBe(false);
    expect(hasPermission("op", "createVisit")).toBe(false);
  });

  it("confines sales executives to their leads", () => {
    expect(canAccessRoute("sales_executive", "/leads")).toBe(true);
    expect(canAccessRoute("sales_executive", "/leads/some-lead")).toBe(true);
    for (const route of ["/patients", "/reception", "/op", "/doctor", "/pharmacy", "/reports", "/visits/x", "/admin/users", "/drug-stock"]) {
      expect(canAccessRoute("sales_executive", route), route).toBe(false);
    }
    expect(hasPermission("sales_executive", "workLeads")).toBe(true);
    expect(hasPermission("sales_executive", "manageLeads")).toBe(false);
    expect(hasPermission("sales_executive", "viewPatients")).toBe(false);
  });

  it("keeps leads away from clinical roles and Meta settings with admin", () => {
    for (const role of ["reception", "op", "doctor", "pharmacy"] as const) {
      expect(canAccessRoute(role, "/leads")).toBe(false);
    }
    for (const role of APP_ROLES) {
      expect(hasPermission(role, "manageIntegrations")).toBe(role === "admin");
    }
    expect(hasPermission("reception", "viewLeadAppointments")).toBe(true);
  });
});
