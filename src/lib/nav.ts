import type { Permission } from "@/lib/rbac";

/** Six screens. The system narrows a list; it does not manage customers. */
export type NavItem = {
  href: string;
  label: string;
  permission: Permission;
};

export const NAV: NavItem[] = [
  { href: "/batches", label: "Batches", permission: "batch:read" },
  { href: "/qualified", label: "Qualified", permission: "qualified:read" },
  { href: "/funnels", label: "Funnels", permission: "funnel:read" },
  { href: "/templates", label: "Templates", permission: "template:read" },
  { href: "/inbox", label: "Inbox", permission: "conversation:read" },
  { href: "/settings", label: "Settings", permission: "settings:read" },
];
