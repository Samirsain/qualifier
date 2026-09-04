import type { Permission } from "@/lib/rbac";

/** README §"Main navigation" — the canonical 14 items, in source order. */
export type NavItem = {
  href: string;
  label: string;
  permission: Permission;
};

export const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", permission: "customer:read" },
  { href: "/inbox", label: "WhatsApp Inbox", permission: "conversation:read" },
  { href: "/customers", label: "Customers", permission: "customer:read" },
  { href: "/leads", label: "Leads", permission: "lead:read" },
  { href: "/follow-ups", label: "Follow-ups", permission: "followup:read" },
  { href: "/campaigns", label: "Campaigns", permission: "campaign:read" },
  { href: "/automations", label: "Automations", permission: "automation:read" },
  { href: "/templates", label: "Templates", permission: "template:read" },
  { href: "/faq", label: "FAQ", permission: "faq:read" },
  { href: "/staff", label: "Staff", permission: "staff:read" },
  { href: "/staff-scoring", label: "Staff Scoring", permission: "staff_score:read" },
  { href: "/analytics", label: "Analytics", permission: "report:read" },
  { href: "/activity", label: "Activity", permission: "activity:read" },
  { href: "/settings", label: "Settings", permission: "settings:read" },
];
