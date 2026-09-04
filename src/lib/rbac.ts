/**
 * RBAC per 11_3_Percent_Club_Security.md §3–§4.
 *
 * Permissions are `module:action` capabilities. The matrix below is the
 * *baseline* the security document defines. Rows the document marks TBD
 * (staff campaign/automation management, manager emergency controls, manager
 * permission admin) default to DENY, as §1 requires: "Default to deny for
 * missing/unknown permissions or record scope."
 */

export const ROLES = ["ADMIN", "MANAGER", "STAFF", "VIEWER"] as const;
export type RoleCode = (typeof ROLES)[number];

export const ROLE_LABELS: Record<RoleCode, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  STAFF: "CRM / Sales Staff",
  VIEWER: "Viewer",
};

export const PERMISSIONS = [
  // customers (F-001, F-002, F-024)
  "customer:read",
  "customer:create",
  "customer:update",
  "customer:delete",
  "customer:assign",
  "customer:read_all", // read beyond own assigned book
  // conversations (F-003)
  "conversation:read",
  "conversation:reply",
  "conversation:close",
  "conversation:assign",
  // leads & follow-ups (F-012, F-013, F-014)
  "lead:read",
  "lead:update",
  "followup:read",
  "followup:manage",
  // calls & meetings (F-015, F-016)
  "call:read",
  "call:manage",
  "meeting:read",
  "meeting:manage",
  // campaigns (F-010)
  "campaign:read",
  "campaign:create",
  "campaign:update",
  "campaign:start",
  "campaign:stop",
  // automations (F-009)
  "automation:read",
  "automation:create",
  "automation:update",
  "automation:activate",
  "automation:pause",
  "automation:pause_all",
  // templates & FAQ (F-011, F-008)
  "template:read",
  "template:manage",
  "faq:read",
  "faq:manage",
  // staff (F-017, F-018)
  "staff:read",
  "staff:manage",
  "staff_score:read",
  "staff_score:read_own",
  "staff_score:configure",
  // analytics & activity (F-020, F-021)
  "report:read",
  "report:manage",
  "activity:read",
  // admin (F-022, F-023)
  "settings:read",
  "settings:manage",
  "permissions:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const MANAGER: Permission[] = [
  "customer:read",
  "customer:read_all",
  "customer:create",
  "customer:update",
  "customer:assign",
  "conversation:read",
  "conversation:reply",
  "conversation:close",
  "conversation:assign",
  "lead:read",
  "lead:update",
  "followup:read",
  "followup:manage",
  "call:read",
  "call:manage",
  "meeting:read",
  "meeting:manage",
  "campaign:read",
  "campaign:create",
  "campaign:update",
  "campaign:start",
  "campaign:stop",
  "automation:read",
  "automation:create",
  "automation:update",
  "automation:activate",
  "automation:pause",
  "template:read",
  "template:manage",
  "faq:read",
  "faq:manage",
  "staff:read",
  "staff_score:read",
  "report:read",
  "report:manage",
  "activity:read",
  "settings:read",
];

// §4: staff act on assigned customers. No `customer:read_all` — visibility of
// unassigned customers is GAP (TBD — Management Decision Required), so denied.
const STAFF: Permission[] = [
  "customer:read",
  "customer:create",
  "customer:update",
  "conversation:read",
  "conversation:reply",
  "conversation:close",
  "lead:read",
  "lead:update",
  "followup:read",
  "followup:manage",
  "call:read",
  "call:manage",
  "meeting:read",
  "meeting:manage",
  "template:read",
  "faq:read",
  "campaign:read",
  "automation:read",
  "staff_score:read_own",
];

const VIEWER: Permission[] = [
  "customer:read",
  "customer:read_all",
  "conversation:read",
  "lead:read",
  "followup:read",
  "call:read",
  "meeting:read",
  "campaign:read",
  "automation:read",
  "template:read",
  "faq:read",
  "staff:read",
  "report:read",
  "activity:read",
];

export const ROLE_PERMISSIONS: Record<RoleCode, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  MANAGER: MANAGER,
  STAFF: STAFF,
  VIEWER: VIEWER,
};

export function permissionsFor(roles: readonly RoleCode[]): Set<Permission> {
  const set = new Set<Permission>();
  for (const role of roles) {
    for (const p of ROLE_PERMISSIONS[role] ?? []) set.add(p);
  }
  return set;
}

export function can(
  roles: readonly RoleCode[],
  permission: Permission,
): boolean {
  return roles.some((r) => ROLE_PERMISSIONS[r]?.includes(permission));
}

/**
 * Record scope for customers. Staff without `customer:read_all` only see
 * customers assigned to them (§3, source-defined assigned-customer intent).
 */
export function customerScope(
  roles: readonly RoleCode[],
  userId: string,
): { assignedStaffId: string } | Record<string, never> {
  return can(roles, "customer:read_all") ? {} : { assignedStaffId: userId };
}
