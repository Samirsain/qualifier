"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";
import type { NavItem } from "@/lib/nav";

export function Sidebar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="flex h-full w-56 shrink-0 flex-col gap-1 border-r border-[color:var(--color-border-default)] bg-[color:var(--color-surface)] p-3"
    >
      <div className="px-2 py-3">
        <span className="text-[length:var(--text-h3)] font-semibold">
          3% Club
        </span>
        <span className="block text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
          Customer Dashboard
        </span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "block rounded-[var(--radius-sm)] px-3 py-2 transition-colors",
                  active
                    ? "bg-[color:var(--color-action-primary)] text-white"
                    : "hover:bg-[color:var(--color-surface-muted)]",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
