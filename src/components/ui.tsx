import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Core components per 05_3_Percent_Club_Design_System.md §6.
 * States the doc requires everywhere: default / hover / focus / disabled /
 * loading / error / empty. Status is never carried by color alone (§2).
 */

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-[length:var(--text-h1)] font-semibold tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-2xl text-[color:var(--color-text-secondary)]">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Card({
  title,
  children,
  className,
  actions,
  flush,
  footer,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
  /** A table fills its card to the edges; padding would fight the rules. */
  flush?: boolean;
  footer?: ReactNode;
}) {
  return (
    <section
      className={cx(
        "overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-[color:var(--color-surface)] shadow-[var(--shadow-surface)]",
        className,
      )}
    >
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--color-border-default)] px-4 py-3">
          {title && (
            <h2 className="text-[length:var(--text-h3)] font-semibold">
              {title}
            </h2>
          )}
          {actions}
        </div>
      )}
      <div className={flush ? undefined : "p-4"}>{children}</div>
      {footer && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--color-border-default)] bg-[color:var(--color-surface-muted)] px-4 py-2.5 text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
          {footer}
        </div>
      )}
    </section>
  );
}

export function StatTile({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  href?: string;
}) {
  const inner = (
    <>
      <div className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
        {label}
      </div>
      <div className="mt-1 text-[length:var(--text-h1)] font-semibold tabular-nums">
        {value}
      </div>
      {hint && (
        <div className="mt-1 text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
          {hint}
        </div>
      )}
    </>
  );
  const base =
    "block rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-[color:var(--color-surface)] p-4 shadow-[var(--shadow-surface)]";
  return href ? (
    <a href={href} className={cx(base, "hover:border-[color:var(--color-action-primary)]")}>
      {inner}
    </a>
  ) : (
    <div className={base}>{inner}</div>
  );
}

type Tone = "neutral" | "success" | "warning" | "error" | "info";

const TONE_CLASS: Record<Tone, string> = {
  neutral:
    "border-[color:var(--color-border-default)] text-[color:var(--color-text-secondary)]",
  success: "border-[color:var(--color-status-success)] text-[color:var(--color-status-success)]",
  warning: "border-[color:var(--color-status-warning)] text-[color:var(--color-status-warning)]",
  error: "border-[color:var(--color-status-error)] text-[color:var(--color-status-error)]",
  info: "border-[color:var(--color-status-info)] text-[color:var(--color-status-info)]",
};

const DOT_CLASS: Record<Tone, string> = {
  neutral: "bg-[color:var(--color-text-secondary)]",
  success: "bg-[color:var(--color-status-success)]",
  warning: "bg-[color:var(--color-status-warning)]",
  error: "bg-[color:var(--color-status-error)]",
  info: "bg-[color:var(--color-status-info)]",
};

/** §2: badges always carry text, so color is never the only status carrier. */
export function Badge({
  children,
  tone = "neutral",
  dot,
}: {
  children: ReactNode;
  tone?: Tone;
  /** A state a number is *in*, rather than a label — reads at a glance. */
  dot?: boolean;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-0.5 text-[length:var(--text-small)] font-medium whitespace-nowrap",
        TONE_CLASS[tone],
      )}
    >
      {dot && (
        <span
          aria-hidden
          className={cx("h-1.5 w-1.5 shrink-0 rounded-full", DOT_CLASS[tone])}
        />
      )}
      {children}
    </span>
  );
}

/**
 * One bar for how a list splits across states.
 *
 * Five equal tiles say how many; one bar says the shape — which is the
 * question someone opening a batch is actually asking.
 */
export function DistributionBar({
  segments,
  className,
}: {
  segments: { label: string; value: number; color: string }[];
  className?: string;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) return null;

  return (
    // One continuous rounded rule: the shape of the split, not five bar charts.
    <div
      className={cx(
        "flex h-1.5 gap-px overflow-hidden rounded-full bg-[color:var(--color-surface-muted)]",
        className,
      )}
    >
      {segments
        .filter((s) => s.value > 0)
        .map((s) => (
          <div
            key={s.label}
            title={`${s.label}: ${s.value}`}
            style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
          />
        ))}
    </div>
  );
}

/** How far along a funnel one number is: filled bars out of the total. */
export function StepMeter({
  done,
  total,
  color,
}: {
  done: number;
  total: number;
  color: string;
}) {
  return (
    <div aria-hidden className="flex gap-[3px]">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className="h-1 w-6 rounded-[2px]"
          style={{
            background: i < done ? color : "var(--color-border-default)",
          }}
        />
      ))}
    </div>
  );
}

/** A count-carrying filter that is a link, so the filter lives in the URL. */
export function FilterChip({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[length:var(--text-small)] whitespace-nowrap transition-colors",
        active
          ? "border-[color:var(--color-action-primary)] bg-[color:var(--color-action-primary)]/8 font-semibold text-[color:var(--color-action-primary)]"
          : "border-[color:var(--color-border-default)] hover:bg-[color:var(--color-surface-muted)]",
      )}
    >
      {label}
      <span className="tabular-nums opacity-70">{count}</span>
    </Link>
  );
}

export function Table({
  head,
  children,
  caption,
}: {
  head: ReactNode[];
  children: ReactNode;
  caption?: string;
}) {
  return (
    // §4: tables may exceed grid width and use controlled horizontal scroll.
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse text-left">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-[color:var(--color-border-default)] bg-[color:var(--color-surface-muted)]">
            {head.map((h, i) => (
              <th
                key={i}
                scope="col"
                className="px-4 py-2.5 text-[11px] font-semibold tracking-[0.03em] text-[color:var(--color-text-secondary)] uppercase"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return (
    <tr className="border-b border-[color:var(--color-border-default)] last:border-0 hover:bg-[color:var(--color-surface-muted)]">
      {children}
    </tr>
  );
}

export function Cell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <td className={cx("px-4 py-3 align-middle", className)}>{children}</td>;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <p className="font-medium">{title}</p>
      {description && (
        <p className="max-w-sm text-[color:var(--color-text-secondary)]">
          {description}
        </p>
      )}
      {action}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-[var(--radius-sm)] border border-[color:var(--color-status-error)] px-3 py-2 text-[color:var(--color-status-error)]"
    >
      {children}
    </p>
  );
}

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";

export const buttonClass = {
  primary: cx(
    BUTTON_BASE,
    "bg-[color:var(--color-action-primary)] text-white hover:bg-[color:var(--color-action-primary-hover)]",
  ),
  secondary: cx(
    BUTTON_BASE,
    "border border-[color:var(--color-border-default)] bg-[color:var(--color-surface)] hover:bg-[color:var(--color-surface-muted)]",
  ),
  danger: cx(
    BUTTON_BASE,
    "bg-[color:var(--color-action-danger)] text-white hover:opacity-90",
  ),
};

export const inputClass =
  "w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-[color:var(--color-surface)] px-3 py-2 text-[color:var(--color-text-primary)] placeholder:text-[color:var(--color-text-secondary)]";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[length:var(--text-small)] font-medium">
        {label}
      </span>
      {children}
      {hint && (
        <span className="mt-1 block text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
          {hint}
        </span>
      )}
    </label>
  );
}
