import "server-only";
import { prisma } from "@/lib/prisma";
import {
  actionConfig,
  branchConfig,
  conditionConfig,
  waitConfig,
} from "@/lib/automation/types";
import { resolveWaitMs } from "@/lib/automation/engine";

/**
 * Pre-activation validation (doc 07 §16).
 *
 * Checks: missing branch targets, unreachable steps, invalid template
 * references, invalid or unresolvable waits, unsupported conditions/actions,
 * and missing exits for terminal branches.
 */
export async function validateAutomation(automationId: string): Promise<string[]> {
  const automation = await prisma.automation.findUnique({
    where: { id: automationId },
    select: { id: true, version: true },
  });
  if (!automation) return ["Automation not found"];

  const steps = await prisma.automationStep.findMany({
    where: { automationId, version: automation.version },
    orderBy: { sortOrder: "asc" },
  });

  if (steps.length === 0) return ["The automation has no steps"];

  const keys = new Set(steps.map((s) => s.stepKey));
  const problems: string[] = [];
  const reachable = new Set<string>();
  const targets = new Map<string, string[]>();

  const templateIds = new Set<string>();

  for (const step of steps) {
    const outgoing: string[] = [];

    switch (step.stepType) {
      case "TRIGGER":
        break;

      case "ACTION": {
        const parsed = actionConfig.safeParse(step.config);
        if (!parsed.success) {
          problems.push(`step "${step.stepKey}": invalid action configuration`);
          break;
        }
        if (parsed.data.action === "send_message") {
          if (!parsed.data.templateId && !parsed.data.body) {
            problems.push(`step "${step.stepKey}": send_message has no body or template`);
          }
          if (parsed.data.templateId) templateIds.add(parsed.data.templateId);
        }
        break;
      }

      case "WAIT": {
        const parsed = waitConfig.safeParse(step.config);
        if (!parsed.success) {
          problems.push(`step "${step.stepKey}": invalid wait configuration`);
          break;
        }
        const ms = await resolveWaitMs(parsed.data);
        if (ms === null) {
          problems.push(
            `step "${step.stepKey}": wait duration "${parsed.data.settingKey}" is not configured yet`,
          );
        } else if (ms <= 0 && !parsed.data.settingKey) {
          problems.push(`step "${step.stepKey}": wait is zero-length`);
        }
        break;
      }

      case "BRANCH": {
        const parsed = branchConfig.safeParse(step.config);
        if (!parsed.success) {
          problems.push(`step "${step.stepKey}": invalid branch configuration`);
          break;
        }
        if (parsed.data.templateId) templateIds.add(parsed.data.templateId);

        const answers = Object.entries(parsed.data.answers);
        if (answers.length === 0) {
          problems.push(`step "${step.stepKey}": branch has no answers`);
        }
        for (const [answer, target] of answers) {
          if (!keys.has(target)) {
            problems.push(
              `step "${step.stepKey}": answer "${answer}" targets missing step "${target}"`,
            );
          } else {
            outgoing.push(target);
          }
        }
        if (parsed.data.otherStepKey) {
          if (!keys.has(parsed.data.otherStepKey)) {
            problems.push(
              `step "${step.stepKey}": otherStepKey targets missing step "${parsed.data.otherStepKey}"`,
            );
          } else {
            outgoing.push(parsed.data.otherStepKey);
          }
        }
        if (parsed.data.timeout && !parsed.data.timeoutStepKey) {
          problems.push(`step "${step.stepKey}": timeout has no target step`);
        }
        if (parsed.data.timeout) {
          /*
           * A branch timeout is a wait, so §16 "invalid/empty waits" applies to
           * it too. An unresolvable duration would leave the run parked with no
           * timer at all and the no-response branch would never fire — inert
           * rather than obviously broken, which is worse.
           */
          const ms = await resolveWaitMs(parsed.data.timeout);
          if (ms === null) {
            problems.push(
              `step "${step.stepKey}": the no-response wait "${parsed.data.timeout.settingKey}" is not configured yet, so this branch would never time out`,
            );
          } else if (ms <= 0) {
            problems.push(`step "${step.stepKey}": the no-response wait is zero-length`);
          }
        }
        if (parsed.data.timeoutStepKey) {
          if (!keys.has(parsed.data.timeoutStepKey)) {
            problems.push(
              `step "${step.stepKey}": timeoutStepKey targets missing step "${parsed.data.timeoutStepKey}"`,
            );
          } else {
            outgoing.push(parsed.data.timeoutStepKey);
          }
        }
        break;
      }

      case "CONDITION": {
        const parsed = conditionConfig.safeParse(step.config);
        if (!parsed.success) {
          problems.push(`step "${step.stepKey}": unsupported condition`);
          break;
        }
        for (const target of [parsed.data.thenStepKey, parsed.data.elseStepKey]) {
          if (!target) continue;
          if (!keys.has(target)) {
            problems.push(
              `step "${step.stepKey}": condition targets missing step "${target}"`,
            );
          } else {
            outgoing.push(target);
          }
        }
        break;
      }

      default:
        problems.push(`step "${step.stepKey}": unsupported step type "${step.stepType}"`);
    }

    if (step.nextStepKey) {
      if (!keys.has(step.nextStepKey)) {
        problems.push(
          `step "${step.stepKey}": next step "${step.nextStepKey}" does not exist`,
        );
      } else {
        outgoing.push(step.nextStepKey);
      }
    }

    targets.set(step.stepKey, outgoing);
  }

  // Reachability from the first step.
  const start = steps[0].stepKey;
  const queue = [start];
  while (queue.length > 0) {
    const key = queue.pop()!;
    if (reachable.has(key)) continue;
    reachable.add(key);
    for (const next of targets.get(key) ?? []) queue.push(next);
  }
  for (const step of steps) {
    if (!reachable.has(step.stepKey)) {
      problems.push(`step "${step.stepKey}" is unreachable`);
    }
  }

  // A funnel that cannot qualify anyone has no output, which is almost
  // certainly a mistake rather than an intent.
  const qualifies = steps.some((step) => {
    const parsed = actionConfig.safeParse(step.config);
    return parsed.success && parsed.data.action === "mark_qualified";
  });
  if (!qualifies) {
    problems.push(
      'the funnel has no "Mark qualified" step, so it can never produce an output',
    );
  }

  // Template availability — an archived or inactive template blocks activation.
  if (templateIds.size > 0) {
    const templates = await prisma.template.findMany({
      where: { id: { in: [...templateIds] } },
      select: { id: true, name: true, active: true, archivedAt: true },
    });
    const found = new Map(templates.map((t) => [t.id, t]));
    for (const id of templateIds) {
      const template = found.get(id);
      if (!template) {
        problems.push(`template ${id} does not exist`);
      } else if (!template.active || template.archivedAt) {
        problems.push(`template "${template.name}" is archived or inactive`);
      }
    }
  }

  return problems;
}
