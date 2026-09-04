import Link from "next/link";
import { markAllRead, markNotificationRead } from "./actions";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  buttonClass,
} from "@/components/ui";
import { titleCase } from "@/lib/labels";
import { notificationHref } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * UI-025 — Notifications (F-019, BR-35). Every entry navigates to the business
 * object it is about, so a notification always leads to a clear action.
 *
 * GAP-013 — channels and urgency levels are undecided, so this is in-app only
 * with no priority ordering beyond recency.
 */
export default async function NotificationsPage() {
  const user = await requireUser();

  const notifications = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: [{ readAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
    take: 100,
  });

  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        description={
          unread > 0 ? `${unread} unread` : "You are up to date."
        }
        actions={
          unread > 0 && (
            <form action={markAllRead}>
              <button type="submit" className={buttonClass.secondary}>
                Mark all read
              </button>
            </form>
          )
        }
      />

      <Card>
        {notifications.length === 0 ? (
          <EmptyState
            title="Nothing to show"
            description="You will be notified when a customer requests a call or meeting, or when work is assigned to you."
          />
        ) : (
          <ul className="flex flex-col">
            {notifications.map((n) => (
              <li
                key={n.id}
                className="flex flex-wrap items-start justify-between gap-3 border-b border-[color:var(--color-border-default)] py-3 last:border-0"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {!n.readAt && <Badge tone="info">New</Badge>}
                    <span className="font-medium">{n.title}</span>
                  </div>
                  {n.body && (
                    <p className="text-[color:var(--color-text-secondary)]">
                      {n.body}
                    </p>
                  )}
                  <p className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
                    {titleCase(n.eventType.replace(/\./g, "_"))} ·{" "}
                    <time dateTime={n.createdAt.toISOString()}>
                      {n.createdAt.toLocaleString()}
                    </time>
                  </p>
                </div>

                <div className="flex gap-2">
                  {n.relatedType && n.relatedId && (
                    <Link
                      href={notificationHref(n.relatedType, n.relatedId)}
                      className={buttonClass.secondary}
                    >
                      Open
                    </Link>
                  )}
                  {!n.readAt && (
                    <form action={markNotificationRead}>
                      <input type="hidden" name="id" value={n.id} />
                      <button type="submit" className={buttonClass.secondary}>
                        Mark read
                      </button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
