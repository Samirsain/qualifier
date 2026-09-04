import { setPauseAllFromSettings } from "./actions";
import { SettingsForm } from "./form";
import { Badge, Card, PageHeader, buttonClass } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { SETTING_SPECS, toFieldValue } from "@/lib/setting-specs";

export const dynamic = "force-dynamic";

/**
 * UI-026 — Settings (F-022, BR-39).
 *
 * Two things live here: the emergency controls, and the business decisions the
 * documentation leaves open. Putting them on one screen is deliberate — an
 * operator dealing with an incident and an operator recording an approved
 * decision are the same person, and both need to see what is currently unset.
 */
export default async function SettingsPage() {
  const user = await requirePermission("settings:read");

  const keys = SETTING_SPECS.map((s) => s.key);
  const [stored, pauseAll, runningCampaigns, activeAutomations] = await Promise.all([
    getSettings([...keys]),
    prisma.systemSetting.findUnique({ where: { key: "automation.pause_all" } }),
    prisma.campaign.count({ where: { status: "RUNNING" } }),
    prisma.automation.count({ where: { status: "ACTIVE" } }),
  ]);

  const isPaused = pauseAll?.value === true;
  const canManage = can(user.roles, "settings:manage");
  const canPauseAll = can(user.roles, "automation:pause_all");

  const unresolved = SETTING_SPECS.filter(
    (s) => stored[s.key] === null || stored[s.key] === undefined,
  );

  return (
    <>
      <PageHeader
        title="Settings"
        description="Emergency controls and the business decisions this system is waiting on."
      />

      <Card title="Emergency controls" className="mb-4">
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
              {activeAutomations} active automation
              {activeAutomations === 1 ? "" : "s"} · {runningCampaigns} running
              campaign{runningCampaigns === 1 ? "" : "s"}.
            </p>
            <p className="mt-1 text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
              Pausing everything stops all journeys advancing and all timers
              firing. Nothing is lost — runs keep their state and resume where
              they stopped. Campaigns are stopped individually from the campaign
              screen.
            </p>
          </div>

          {canPauseAll ? (
            <form action={setPauseAllFromSettings}>
              <input type="hidden" name="paused" value={isPaused ? "false" : "true"} />
              <button
                type="submit"
                className={isPaused ? buttonClass.primary : buttonClass.danger}
              >
                {isPaused ? "Resume all automations" : "Pause all automations"}
              </button>
            </form>
          ) : (
            <p className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
              Only an administrator can use this control.
            </p>
          )}
        </div>
      </Card>

      <Card title="Open business decisions" className="mb-4">
        {unresolved.length === 0 ? (
          <p className="text-[color:var(--color-status-success)]">
            Every decision this screen tracks has been recorded.
          </p>
        ) : (
          <>
            <p className="mb-3">
              <Badge tone="warning">{unresolved.length} unresolved</Badge>
            </p>
            <ul className="flex flex-col gap-2">
              {unresolved.map((s) => (
                <li key={s.key}>
                  <span className="font-medium">{s.label}</span>{" "}
                  <span className="text-[color:var(--color-text-secondary)]">
                    ({s.gap})
                  </span>
                  <p className="text-[length:var(--text-small)] text-[color:var(--color-text-secondary)]">
                    While unset: {s.whileUnset}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card title="Business configuration">
        {canManage ? (
          <SettingsForm
            values={Object.fromEntries(
              SETTING_SPECS.map((s) => [s.key, toFieldValue(stored[s.key])]),
            )}
          />
        ) : (
          <p className="text-[color:var(--color-text-secondary)]">
            You can see these values but not change them. Ask an administrator.
          </p>
        )}
      </Card>
    </>
  );
}
