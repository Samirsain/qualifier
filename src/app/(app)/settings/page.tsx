import Link from "next/link";
import { setPauseAllFromSettings } from "./actions";
import { OptOutForm } from "./form";
import { Badge, Card, PageHeader, buttonClass } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Two controls, because two are all the code reads: the emergency stop
 * (`engine.ts`) and the opt-out words (`whatsapp/inbound.ts`).
 *
 * The screen used to offer four more — a no-response wait, a reporting
 * timezone, a send window, a default country. Nothing read any of them: waits
 * live in the funnel's own Wait step, the analytics screens are gone, and the
 * phone parser hardcodes India. A setting nobody reads is not a decision, it
 * is a question with no effect, so it is gone.
 */
export default async function SettingsPage() {
  const user = await requirePermission("settings:read");

  const [pauseAll, keywords, activeAutomations] = await Promise.all([
    getSetting("automation.pause_all"),
    getSetting("optout.keywords"),
    prisma.automation.count({ where: { status: "ACTIVE" } }),
  ]);

  const isPaused = pauseAll === true;
  const canManage = can(user.roles, "settings:manage");
  const canPauseAll = can(user.roles, "automation:pause_all");
  const current = Array.isArray(keywords)
    ? keywords.filter((k): k is string => typeof k === "string").join(", ")
    : "";

  return (
    <>
      <PageHeader
        title="Settings"
        description="The emergency stop, and the words that opt a number out."
        actions={
          <Link href="/activity" className={buttonClass.secondary}>
            Activity log
          </Link>
        }
      />

      <Card title="Emergency stop" className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-medium">
              Automations:{" "}
              {isPaused ? (
                <Badge tone="error">All paused</Badge>
              ) : (
                <Badge tone="success">Running normally</Badge>
              )}
            </p>
            <p className="mt-1 text-[color:var(--color-text-secondary)]">
              {activeAutomations} active funnel{activeAutomations === 1 ? "" : "s"}.
            </p>
            <p className="mt-1 text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
              Pausing stops every funnel advancing and every timer firing.
              Nothing is lost — each number keeps its place and carries on from
              there when you resume.
            </p>
          </div>

          {canPauseAll ? (
            <form action={setPauseAllFromSettings}>
              <input type="hidden" name="paused" value={isPaused ? "false" : "true"} />
              <button
                type="submit"
                className={isPaused ? buttonClass.primary : buttonClass.danger}
              >
                {isPaused ? "Resume all funnels" : "Pause all funnels"}
              </button>
            </form>
          ) : (
            <p className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
              Only an administrator can use this control.
            </p>
          )}
        </div>
      </Card>

      <Card title="Opt-out words">
        {canManage ? (
          <OptOutForm value={current} />
        ) : (
          <p className="text-[color:var(--color-text-secondary)]">
            {current || "No words set, so nothing opts a number out."} You can
            see this but not change it. Ask an administrator.
          </p>
        )}
      </Card>
    </>
  );
}
