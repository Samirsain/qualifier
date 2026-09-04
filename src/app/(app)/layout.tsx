import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/auth";
import { Sidebar } from "@/components/sidebar";
import { Badge, buttonClass } from "@/components/ui";
import { NAV } from "@/lib/nav";
import { prisma } from "@/lib/prisma";
import { can, ROLE_LABELS } from "@/lib/rbac";
import { requireUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  // Nav visibility is usability only; every page re-checks server-side.
  const items = NAV.filter((item) => can(user.roles, item.permission));

  const unread = await prisma.notification.count({
    where: { userId: user.id, readAt: null },
  });

  return (
    <div className="flex min-h-screen">
      <Sidebar items={items} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end gap-4 border-b border-[color:var(--color-border-default)] bg-[color:var(--color-surface)] px-6 py-3">
          <Link
            href="/notifications"
            className="flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 hover:bg-[color:var(--color-surface-muted)]"
          >
            Notifications
            {unread > 0 && <Badge tone="info">{unread}</Badge>}
          </Link>
          <div className="text-right">
            <div className="font-medium">{user.name || user.email}</div>
            <div className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
              {user.roles.map((r) => ROLE_LABELS[r]).join(", ") || "No role"}
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
