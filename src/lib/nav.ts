import type { Permission } from "@/lib/rbac";

/**
 * Six screens in two groups: what is running now, and what it runs on.
 * The split is the daily rhythm — batches and their output are visited every
 * day, funnels and templates only when something changes.
 */
export type NavIcon =
  | "batches"
  | "tracking"
  | "qualified"
  | "funnels"
  | "templates"
  | "settings";

export type NavItem = {
  href: string;
  label: string;
  permission: Permission;
  icon: NavIcon;
  group: "Running" | "Set up";
};

export const NAV: NavItem[] = [
  { href: "/batches", label: "Batches", permission: "batch:read", icon: "batches", group: "Running" },
  { href: "/tracking", label: "Tracking", permission: "batch:read", icon: "tracking", group: "Running" },
  { href: "/qualified", label: "Qualified", permission: "qualified:read", icon: "qualified", group: "Running" },
  { href: "/funnels", label: "Funnels", permission: "funnel:read", icon: "funnels", group: "Set up" },
  { href: "/templates", label: "Templates", permission: "template:read", icon: "templates", group: "Set up" },
  { href: "/settings", label: "Settings", permission: "settings:read", icon: "settings", group: "Set up" },
];
