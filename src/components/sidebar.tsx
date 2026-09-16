"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";
import type { NavIcon, NavItem } from "@/lib/nav";

/**
 * Stroke icons on a 24px grid, one weight. They are wayfinding, not decoration,
 * so the label always stays next to them.
 */
const ICONS: Record<NavIcon, React.ReactNode> = {
  batches: (
    <>
      <rect x="3" y="4" width="18" height="6" rx="2" />
      <rect x="3" y="14" width="18" height="6" rx="2" />
    </>
  ),
  tracking: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <path d="M9 9v11" />
    </>
  ),
  qualified: <path d="M20 6 9 17l-5-5" />,
  funnels: (
    <>
      <path d="M6 4v6a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4" />
      <path d="M12 16v4" />
    </>
  ),
  templates: (
    <>
      <path d="M4 6h16" />
      <path d="M4 12h10" />
      <path d="M4 18h13" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M4.6 15a1.6 1.6 0 0 1-.3 1.8l-.1.1a2 2 0 1 0 2.8 2.8l.1-.1a1.6 1.6 0 0 1 2.7 1.1V21a2 2 0 1 0 4 0v-.1a1.6 1.6 0 0 1 2.7-1.1l.1.1a2 2 0 1 0 2.8-2.8l-.1-.1a1.6 1.6 0 0 1 1.1-2.7H21a2 2 0 1 0 0-4h-.1a1.6 1.6 0 0 1-1.1-2.7l.1-.1a2 2 0 1 0-2.8-2.8l-.1.1A1.6 1.6 0 0 1 15 4.6V4a2 2 0 1 0-4 0v.1A1.6 1.6 0 0 1 9 4.6" />
    </>
  ),
};

function Icon({ name, active }: { name: NavIcon; active: boolean }) {
  return (
    <svg
      aria-hidden
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={
        active ? "var(--color-action-primary)" : "var(--color-text-secondary)"
      }
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      {ICONS[name]}
    </svg>
  );
}

export type NavCounts = Partial<Record<string, number>>;

export function Sidebar({
  items,
  counts,
  paused,
}: {
  items: NavItem[];
  /** Keyed by href, so a screen's weight is visible before opening it. */
  counts: NavCounts;
  paused: boolean;
}) {
  const pathname = usePathname();
  const groups = ["Running", "Set up"] as const;

  return (
    <nav
      aria-label="Main"
      className="flex h-full w-58 shrink-0 flex-col gap-6 border-r border-[color:var(--color-border-default)] bg-[color:var(--color-surface)] p-3"
    >
      <div className="flex items-center gap-2.5 px-2 py-1">
        <span
          aria-hidden
          className="flex h-[30px] w-[30px] items-center justify-center rounded-[var(--radius-md)] bg-[color:var(--color-action-primary)] text-[length:var(--text-small)] font-semibold tracking-tight text-white"
        >
          3%
        </span>
        <span className="flex flex-col leading-tight">
          <span className="font-semibold tracking-tight">
            3% Club
          </span>
          <span className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
            Qualification filter
          </span>
        </span>
      </div>

      {groups.map((group) => {
        const inGroup = items.filter((item) => item.group === group);
        if (inGroup.length === 0) return null;

        return (
          <div key={group} className="flex flex-col gap-0.5">
            <span className="px-2 pb-1.5 text-[11px] font-semibold tracking-[0.06em] text-[color:var(--color-text-secondary)] uppercase">
              {group}
            </span>
            <ul className="flex flex-col gap-0.5">
              {inGroup.map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);
                const count = counts[item.href];

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        "flex items-center gap-2.5 rounded-[var(--radius-sm)] py-2 pr-2 pl-2.5 transition-colors",
                        active
                          ? "bg-[color:var(--color-surface-muted)] font-semibold shadow-[inset_2px_0_0_var(--color-action-primary)]"
                          : "hover:bg-[color:var(--color-surface-muted)]",
                      )}
                    >
                      <Icon name={item.icon} active={active} />
                      <span>{item.label}</span>
                      {count !== undefined && (
                        <span className="ml-auto rounded-full border border-[color:var(--color-border-default)] px-1.5 text-[length:var(--text-small)] font-semibold tabular-nums text-[color:var(--color-text-secondary)]">
                          {count}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      {paused && (
        // A paused system looks identical to an idle one. Say so where the
        // person already is, rather than only on the screen holding the switch.
        <div className="mt-auto flex flex-col gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-status-warning)] bg-[color:var(--color-status-warning)]/10 p-3">
          <span className="flex items-center gap-2 text-[length:var(--text-small)] font-semibold">
            <svg
              aria-hidden
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-status-warning)"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
            All funnels paused
          </span>
          <span className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
            Nothing is being sent. Numbers keep their place.
          </span>
          <Link
            href="/settings"
            className="rounded-[var(--radius-sm)] bg-[color:var(--color-action-primary)] px-2.5 py-1.5 text-center text-[length:var(--text-small)] font-semibold text-white hover:bg-[color:var(--color-action-primary-hover)]"
          >
            Resume sending
          </Link>
        </div>
      )}
    </nav>
  );
}
