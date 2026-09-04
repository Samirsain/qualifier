/**
 * Two roles. There is no staff structure — the CRM team works outside this
 * system, so there is nobody to assign customers to and nothing to score.
 */

export const ROLES = ["ADMIN", "VIEWER"] as const;
export type RoleCode = (typeof ROLES)[number];

export const ROLE_LABELS: Record<RoleCode, string> = {
  ADMIN: "Admin",
  VIEWER: "Viewer",
};

export const PERMISSIONS = [
  "batch:read",
  "batch:manage",
  "qualified:read",
  "qualified:export",
  "funnel:read",
  "funnel:manage",
  "template:read",
  "template:manage",
  "conversation:read",
  "conversation:reply",
  "settings:read",
  "settings:manage",
  "automation:pause_all",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: Permission[] = [
  "batch:read",
  "qualified:read",
  "qualified:export",
  "funnel:read",
  "template:read",
  "conversation:read",
  "settings:read",
];

export const ROLE_PERMISSIONS: Record<RoleCode, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  VIEWER: VIEWER,
};

export function can(roles: readonly RoleCode[], permission: Permission): boolean {
  return roles.some((r) => ROLE_PERMISSIONS[r]?.includes(permission));
}
