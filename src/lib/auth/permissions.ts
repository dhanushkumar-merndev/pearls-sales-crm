import type { AppRole } from "@/types/hospital";

export const PERMISSIONS = {
  manageUsers: ["admin"],
  manageDoctors: ["admin"],
  // Identity-only search (name/phone/UHID), used by the patient-picker
  // combobox everywhere it appears -- including the pharmacy counter's
  // procedure billing, which needs to attach a bill to a patient. This is not
  // the /patients directory route, which stays narrower (see ROUTE_ROLES).
  viewPatients: ["admin", "reception", "op", "doctor", "pharmacy"],
  // Reception owns the patient register and the visit/token desk.
  createPatient: ["admin", "reception"],
  createVisit: ["admin", "reception"],
  // The OP desk records vitals; the treating doctor may correct them.
  recordVitals: ["admin", "op", "doctor"],
  writeConsultation: ["admin", "doctor"],
  // Narrower than writeConsultation on purpose: only the consultation form
  // itself (entering exactly what the doctor wrote on paper), not report
  // uploads -- those stay with the front desk.
  pharmacyEnterConsultation: ["admin", "doctor", "pharmacy"],
  dispense: ["admin", "pharmacy"],
  // A consultant who wrote the prescription on paper never touches the
  // system; pharmacy enters it digitally so it flows through the same
  // pending queue and dispense screen ("Dispense as Per Rx").
  dispenseAsPerRx: ["admin", "pharmacy"],
  viewFullFinance: ["admin"],
  viewVisitFinance: ["admin", "reception"],
  // Same fee the pharmacy counter already collects when dispensing medicines
  // (dispense_prescription) -- this covers the visit that has none, which
  // otherwise had no way to ever be settled.
  collectVisitPayment: ["admin", "reception", "pharmacy"],
  uploadReport: ["admin", "reception", "op"],
  manageMedicine: ["admin", "pharmacy"],
  viewAudit: ["admin"],
  // Leads CRM. Sales executives work the leads assigned to them; admin sees
  // every lead, reassigns, and owns the Meta Lead Ads connection.
  workLeads: ["admin", "sales_executive"],
  manageLeads: ["admin"],
  manageIntegrations: ["admin"],
  // Reception turns a booked lead into a real visit when the person arrives.
  viewLeadAppointments: ["admin", "reception"],
} as const satisfies Record<string, readonly AppRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function hasPermission(role: AppRole, permission: Permission) {
  return (PERMISSIONS[permission] as readonly AppRole[]).includes(role);
}

export const ROUTE_ROLES: Record<string, readonly AppRole[]> = {
  "/admin": ["admin"],
  "/audit": ["admin"],
  "/patients": ["admin", "reception", "op", "doctor"],
  // Bulk register import writes patient records, so it is narrower than the
  // patient directory itself and matches the bulk_import_patients RPC guard.
  "/patients/import": ["admin", "reception"],
  "/reception": ["admin", "reception"],
  "/op": ["admin", "op"],
  "/doctor": ["admin", "doctor"],
  "/pharmacy": ["admin", "pharmacy"],
  // Doctors read only: they review the results they ordered. The upload
  // action stays behind the uploadReport permission.
  "/reports": ["admin", "reception", "op", "doctor"],
  "/visits": ["admin", "reception", "op", "doctor", "pharmacy"],
  // Read-only stock check for clinical care -- not stock management, which
  // stays under /pharmacy.
  "/drug-stock": ["admin", "reception", "doctor", "op"],
  "/leads": ["admin", "sales_executive"],
};

export function canAccessRoute(role: AppRole, pathname: string) {
  const entry = Object.entries(ROUTE_ROLES)
    .sort(([a], [b]) => b.length - a.length)
    .find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return !entry || entry[1].includes(role);
}
