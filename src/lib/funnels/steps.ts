/**
 * The builder edits an ordered list. The engine reads a graph.
 *
 * This module is the only place that converts between the two, so the builder
 * never has to know about step types, and the engine never has to know a list
 * existed.
 */

export type BuilderStep =
  | { kind: "message"; key: string; templateId: string }
  | { kind: "wait"; key: string; days: number; hours: number }
  | { kind: "qualify"; key: string }
  | { kind: "stop"; key: string; reason: string }
  | {
      kind: "question";
      key: string;
      templateId: string;
      prompt: string;
      questionKey: string;
      yesKey: string | null;
      noKey: string | null;
      otherKey: string | null;
    };

export type EngineStepInput = {
  stepKey: string;
  stepType: "ACTION" | "WAIT" | "BRANCH";
  config: unknown;
  nextStepKey: string | null;
  sortOrder: number;
};

export type EngineStepRow = EngineStepInput & { version?: number };

/** Ten apart so a step can be inserted without renumbering everything. */
const STRIDE = 10;

export function toEngineSteps(steps: BuilderStep[]): EngineStepInput[] {
  return steps.map((step, i) => {
    const next = steps[i + 1]?.key ?? null;
    const sortOrder = i * STRIDE;

    switch (step.kind) {
      case "message":
        return {
          stepKey: step.key,
          stepType: "ACTION",
          config: { action: "send_message", templateId: step.templateId },
          nextStepKey: next,
          sortOrder,
        };

      case "wait":
        return {
          stepKey: step.key,
          stepType: "WAIT",
          config: { days: step.days, hours: step.hours },
          nextStepKey: next,
          sortOrder,
        };

      case "qualify":
        return {
          stepKey: step.key,
          stepType: "ACTION",
          config: { action: "mark_qualified" },
          nextStepKey: next,
          sortOrder,
        };

      case "stop":
        // Terminates the branch. A linear list needs an explicit terminator,
        // or two terminal paths fall through into one another.
        return {
          stepKey: step.key,
          stepType: "ACTION",
          config: { action: "stop_journey", reason: step.reason },
          nextStepKey: null,
          sortOrder,
        };

      case "question": {
        const answers: Record<string, string> = {};
        if (step.yesKey) answers.YES = step.yesKey;
        if (step.noKey) answers.NO = step.noKey;
        return {
          stepKey: step.key,
          stepType: "BRANCH",
          config: {
            questionKey: step.questionKey,
            prompt: step.prompt,
            templateId: step.templateId,
            answers,
            ...(step.otherKey ? { otherStepKey: step.otherKey } : {}),
          },
          // A branch's exits are its answers. An implicit next would be a
          // second path out of the same step.
          nextStepKey: null,
          sortOrder,
        };
      }
    }
  });
}

export function fromEngineSteps(rows: EngineStepRow[]): BuilderStep[] {
  return [...rows]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((row): BuilderStep => {
      if (row.stepType === "WAIT") {
        const c = row.config as { days?: number; hours?: number };
        return {
          kind: "wait",
          key: row.stepKey,
          days: c.days ?? 0,
          hours: c.hours ?? 0,
        };
      }

      if (row.stepType === "BRANCH") {
        const c = row.config as {
          questionKey: string;
          prompt: string;
          templateId?: string;
          answers?: Record<string, string>;
          otherStepKey?: string;
        };
        return {
          kind: "question",
          key: row.stepKey,
          templateId: c.templateId ?? "",
          prompt: c.prompt,
          questionKey: c.questionKey,
          yesKey: c.answers?.YES ?? null,
          noKey: c.answers?.NO ?? null,
          otherKey: c.otherStepKey ?? null,
        };
      }

      const c = row.config as { action: string; templateId?: string; reason?: string };
      if (c.action === "mark_qualified") {
        return { kind: "qualify", key: row.stepKey };
      }
      if (c.action === "stop_journey") {
        return { kind: "stop", key: row.stepKey, reason: c.reason ?? "" };
      }
      return {
        kind: "message",
        key: row.stepKey,
        templateId: c.templateId ?? "",
      };
    });
}

export function validateBuilderSteps(steps: BuilderStep[]): string[] {
  const problems: string[] = [];

  if (steps.length === 0) {
    problems.push("The funnel has no steps.");
    return problems;
  }

  const keys = new Set<string>();
  for (const step of steps) {
    if (keys.has(step.key)) {
      problems.push(`Duplicate step key "${step.key}".`);
    }
    keys.add(step.key);
  }

  // A funnel that cannot qualify anyone produces nothing.
  if (!steps.some((s) => s.kind === "qualify")) {
    problems.push(
      'The funnel has no "Mark qualified" step, so it can never qualify anyone.',
    );
  }

  for (const step of steps) {
    if (step.kind === "wait" && step.days === 0 && step.hours === 0) {
      problems.push(`Step "${step.key}" waits for zero time.`);
    }

    if (step.kind === "question") {
      if (!step.yesKey && !step.noKey) {
        problems.push(`Question "${step.key}" has no answers wired up.`);
      }
      for (const [label, target] of [
        ["YES", step.yesKey],
        ["NO", step.noKey],
        ["unrecognised reply", step.otherKey],
      ] as const) {
        if (target && !keys.has(target)) {
          problems.push(
            `Question "${step.key}" sends ${label} to "${target}", which does not exist.`,
          );
        }
      }
      if (!step.prompt.trim()) {
        problems.push(`Question "${step.key}" has no prompt text.`);
      }
    }

    if ((step.kind === "message" || step.kind === "question") && !step.templateId) {
      problems.push(`Step "${step.key}" has no template selected.`);
    }
  }

  return problems;
}
