export const APP_ROLES = [
  "admin",
  "reception",
  "op",
  "doctor",
  "pharmacy",
  "sales_executive",
] as const;

export type AppRole = (typeof APP_ROLES)[number];

/**
 * Roles an admin creates from Users. Doctors are created from the Doctor
 * workflow instead, so their login and doctor record are linked together.
 */
export const STAFF_ROLES = [
  "admin",
  "reception",
  "op",
  "pharmacy",
  "sales_executive",
] as const satisfies readonly AppRole[];

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Admin",
  reception: "Reception",
  op: "OP",
  doctor: "Doctor",
  pharmacy: "Pharmacy",
  sales_executive: "Sales Executive",
};

export type Profile = {
  id: string;
  fullName: string;
  email: string;
  role: AppRole;
  status: "active" | "inactive";
  doctorId: string | null;
};

export type NavItem = {
  title: string;
  href: string;
  icon: string;
};

export type ActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
  data?: Record<string, string | number | boolean | null>;
};
