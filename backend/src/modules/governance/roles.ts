/**
 * Roles and permissions. Access is **deny by default**: an unknown or missing role is
 * rejected, and a permission that is not explicitly granted is denied.
 *
 * Authors never approve their own pills (FR-03) — see `pill.service.ts`.
 */

import { ForbiddenError } from "@/shared/errors";

export const ROLES = [
  "aom",
  "chief_engineer",
  "pill_reviewer",
  "site_operator",
  "governance_admin",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  aom: "Asset Operations Manager",
  chief_engineer: "Chief Engineer (pill owner)",
  pill_reviewer: "Pill Reviewer",
  site_operator: "Site Operator / Technician",
  governance_admin: "Governance Admin",
};

export const ROLE_DESCRIPTIONS: Record<Role, { can: string; cannot: string }> = {
  aom: {
    can: "Run cases, read cited options, approve execute-tier actions, record outcomes",
    cannot: "Edit or approve pills",
  },
  chief_engineer: {
    can: "Run capture interviews, draft and revise pills in their own domain",
    cannot: "Approve their own pill",
  },
  pill_reviewer: {
    can: "Approve, reject, retire, roll back, sign off cross-site transfer",
    cannot: "Run live cases on assets they review",
  },
  site_operator: {
    can: "Read approved pills, log observations and outcomes",
    cannot: "See draft pills or tenant lease data",
  },
  governance_admin: {
    can: "Manage roles, view the audit log, export pills",
    cannot: "Change pill content",
  },
};

const ALL_ROLES: readonly Role[] = ROLES;

export const PERMISSIONS = {
  "case:read": ALL_ROLES,
  "case:run": ["aom", "site_operator", "chief_engineer"],
  "pill:read": ALL_ROLES,
  "pill:capture": ["chief_engineer"],
  "pill:review": ["pill_reviewer"],
  "pill:rollback": ["pill_reviewer"],
  "audit:read": ["governance_admin", "pill_reviewer"],
  "pill:export": ["governance_admin"],
  "seed:run": ["governance_admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/** Throw unless the role holds the permission. */
export function assertCan(role: Role, permission: Permission): void {
  if (can(role, permission)) return;

  const permitted = (PERMISSIONS[permission] as readonly Role[])
    .map((item) => ROLE_LABELS[item])
    .join(", ");

  throw new ForbiddenError(
    `Role '${ROLE_LABELS[role]}' may not perform '${permission}'. Permitted: ${permitted}.`,
    { role, permission },
  );
}

/** The permissions a role holds — used by the console to hide what it cannot do. */
export function permissionsFor(role: Role): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((permission) => can(role, permission));
}
