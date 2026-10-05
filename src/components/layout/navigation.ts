import type { AppRole } from "@/types/hospital";

export type NavigationItem = {
  title: string;
  href: string;
  icon: string;
  /** Sidebar section. Defaults to the role's primary workspace group. */
  group?: string;
  /** Used only when no declared destination directly matches a detail route. */
  fallbackPrefixes?: string[];
};

/** Groups nav items by their `group`, preserving declaration order. */
export function groupNavigation(
  items: NavigationItem[],
  defaultGroup: string,
): Array<{ label: string; items: NavigationItem[] }> {
  const groups: Array<{ label: string; items: NavigationItem[] }> = [];
  for (const item of items) {
    const label = item.group ?? defaultGroup;
    const existing = groups.find((group) => group.label === label);
    if (existing) existing.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

export function getActiveNavigationHref(
  items: NavigationItem[],
  pathname: string,
) {
  const directMatch = items
    .filter(
      (item) =>
        pathname === item.href ||
        (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`)),
    )
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  if (directMatch) return directMatch;
  return items.find((item) =>
    item.fallbackPrefixes?.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    ),
  )?.href;
}

const shared = {
  dashboard: { title: "Dashboard", href: "/dashboard", icon: "layout-dashboard" },
  patients: { title: "Patients", href: "/patients", icon: "users" },
} satisfies Record<string, NavigationItem>;

export const ROLE_NAVIGATION: Record<AppRole, NavigationItem[]> = {
  admin: [
    shared.dashboard, shared.patients,
    { title: "Leads", href: "/leads", icon: "megaphone" },
    { title: "Referrals", href: "/admin/referrals", icon: "handshake" },
    { title: "Reception", href: "/reception", icon: "concierge-bell" },
    { title: "OP", href: "/op", icon: "stethoscope" },
    { title: "Doctors", href: "/doctor", icon: "user-round-check" },
    { title: "Pharmacy", href: "/pharmacy", icon: "pill" },
    { title: "Reports", href: "/admin/analytics", icon: "chart-column" },
    { title: "Users", href: "/admin/users", icon: "user-cog", group: "Administration" },
    { title: "Doctor Master", href: "/admin/doctors", icon: "briefcase-medical", group: "Administration" },
    { title: "Masters", href: "/admin/masters", icon: "library", group: "Administration" },
    { title: "Meta Lead Ads", href: "/admin/integrations/meta", icon: "plug", group: "Administration" },
    { title: "Clinical Directory", href: "/admin/clinical-directory", icon: "book-open", group: "Administration" },
    // The same page pharmacy works in, reached from where an admin looks for
    // a master list. One route, so there is one medicine library, not two.
    { title: "Medicine Directory", href: "/pharmacy/medicines", icon: "pill", group: "Administration" },
    { title: "Monthly Export", href: "/admin/exports", icon: "archive-restore", group: "Administration" },
    { title: "Settings", href: "/admin/settings", icon: "settings", group: "Administration" },
    { title: "Audit Logs", href: "/audit", icon: "shield-check", group: "Security" },
  ],
  reception: [
    shared.dashboard, shared.patients,
    { title: "Today's Visits", href: "/reception", icon: "calendar-days" },
    { title: "Lead Appointments", href: "/reception/lead-appointments", icon: "calendar-heart" },
    { title: "Follow-ups", href: "/reception/follow-ups", icon: "calendar-check" },
    { title: "Reports Ready", href: "/reports", icon: "file-check" },
    { title: "Fees & Payments", href: "/reception/payments", icon: "indian-rupee" },
    { title: "Drug Stock", href: "/drug-stock", icon: "pill" },
  ],
  op: [
    shared.dashboard,
    { title: "Today OP", href: "/op", icon: "list-ordered" },
    { title: "Patient Assist", href: "/op/assist", icon: "route" },
    { title: "Patients", href: "/patients", icon: "users" },
    { title: "Reports", href: "/reports", icon: "files" },
    { title: "Drug Stock", href: "/drug-stock", icon: "pill" },
  ],
  doctor: [
    shared.dashboard,
    { title: "Today OP", href: "/doctor", icon: "list-ordered" },
    { title: "My Follow-ups", href: "/doctor/follow-ups", icon: "calendar-check" },
    // A doctor who ordered an investigation needs somewhere to go when the
    // result comes back; the notification bell links here too.
    { title: "Reports", href: "/reports", icon: "files" },
    { title: "Patient Search", href: "/patients", icon: "search" },
    // Read-only stock check before writing a prescription -- not stock
    // management, which stays pharmacy-only.
    { title: "Drug Stock", href: "/drug-stock", icon: "pill" },
  ],
  pharmacy: [
    shared.dashboard,
    { title: "Pending Prescriptions", href: "/pharmacy", icon: "clipboard-list" },
    { title: "Medicine Master", href: "/pharmacy/medicines", icon: "pill" },
    { title: "Stock & Batches", href: "/pharmacy/stock", icon: "package" },
    { title: "Inventory", href: "/pharmacy/inventory", icon: "boxes" },
    { title: "Bulk Import", href: "/pharmacy/import", icon: "file-up" },
    { title: "Sales", href: "/pharmacy/sales", icon: "receipt" },
  ],
  sales_executive: [
    shared.dashboard,
    { title: "My Leads", href: "/leads", icon: "megaphone" },
    { title: "Follow-ups Due", href: "/leads/follow-ups", icon: "phone-call" },
    { title: "Booked", href: "/leads/booked", icon: "calendar-heart" },
  ],
};
