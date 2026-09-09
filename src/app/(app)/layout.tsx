import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/auth";
import { Sidebar } from "@/components/sidebar";
import { Badge, buttonClass } from "@/components/ui";
import { NAV } from "@/lib/nav";
import { prisma } from "@/lib/prisma";
import { can, ROLE_LABELS } from "@/lib/rbac";
import { requireUser } from "@/lib/session";
import { getSetting } from "@/lib/settings";

function initials(name: string, email: string) {
  const source = name.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  // Nav visibility is usability only; every page re-checks server-side.
  const items = NAV.filter((item) => can(user.roles, item.permission));

  const [unread, batches, qualified, pauseAll] = await Promise.all([
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    prisma.batch.count(),
    prisma.customer.count({ where: { status: "QUALIFIED" } }),
    getSetting("automation.pause_all"),
  ]);

  return (
    <div className="flex min-h-screen">
      <Sidebar
        items={items}
        counts={{ "/batches": batches, "/qualified": qualified }}
        paused={pauseAll === true}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end gap-4 border-b border-[color:var(--color-border-default)] bg-[color:var(--color-surface)] px-6 py-2.5">
          <Link
            href="/notifications"
            className="flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 hover:bg-[color:var(--color-surface-muted)]"
          >
            Notifications
            {unread > 0 && <Badge tone="info">{unread}</Badge>}
          </Link>
          <div className="h-5 w-px bg-[color:var(--color-border-default)]" />
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-[color:var(--color-surface-muted)] text-[length:var(--text-small)] font-semibold"
            >
              {initials(user.name, user.email)}
            </span>
            <div className="text-right leading-tight">
              <div className="text-[length:var(--text-small)] font-semibold">
                {user.name || user.email}
              </div>
              <div className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
                {user.roles.map((r) => ROLE_LABELS[r]).join(", ") || "No role"}
              </div>
            </div>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button type="submit" className={buttonClass.secondary}>
              Sign out
            </button>
          </form>
        </header>
        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
