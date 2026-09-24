"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROLE_LABELS } from "@/types/hospital";

const labelFor = (role: string) => (ROLE_LABELS as Record<string, string>)[role] ?? role;


/**
 * URL-driven role filter dropdown. Selecting a role narrows the staff table
 * to just that role; "All roles" clears the filter. Server-rendered pages
 * read the same `role` param this writes, so the filter survives a refresh
 * and is shareable as a link.
 */
export function RoleFilterSelect({
  roles,
  value,
  paramName = "role",
}: {
  roles: readonly string[];
  value: string;
  paramName?: string;
}) {
  const router = useRouter();
  return (
    <Select
      value={value || "all"}
      onValueChange={(next) => {
        const params = new URLSearchParams(window.location.search);
        if (next === "all") params.delete(paramName);
        else params.set(paramName, String(next));
        params.delete("page");
        const query = params.toString();
        router.push(`${window.location.pathname}${query ? `?${query}` : ""}`, {
          scroll: false,
        });
      }}
    >
      <SelectTrigger className="w-40" aria-label="Filter by role">
        <SelectValue placeholder="All roles">
          {() => (value && value !== "all" ? labelFor(value) : "All roles")}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all" label="All roles">
          All roles
        </SelectItem>
        {roles.map((role) => (
          <SelectItem key={role} value={role} label={labelFor(role)}>
            {labelFor(role)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
