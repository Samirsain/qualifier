import { fromEngineSteps, type BuilderStep, type EngineStepRow } from "./steps";

/**
 * The engine stores a step key. A person reading the batch page needs
 * "3/7 · Question: are you interested?" — so the same list the builder edits
 * is what names the position a number has reached.
 */
export type StepLabel = {
  position: string;
  /** 1-based, so a meter can fill `index` of `total` bars. */
  index: number;
  total: number;
  label: string;
};

function labelOf(step: BuilderStep, templateNames: Map<string, string>): string {
  switch (step.kind) {
    case "message":
      return `Message: ${templateNames.get(step.templateId) ?? "untitled"}`;
    case "wait": {
      const parts = [];
      if (step.days) parts.push(`${step.days}d`);
      if (step.hours) parts.push(`${step.hours}h`);
      return `Wait ${parts.join(" ") || "0h"}`;
    }
    case "qualify":
      return "Mark qualified";
    case "stop":
      return step.reason ? `Stop: ${step.reason}` : "Stop";
    case "question":
      return `Question: ${step.prompt || templateNames.get(step.templateId) || "untitled"}`;
  }
}

export function stepLabels(
  rows: EngineStepRow[],
  templateNames: Map<string, string> = new Map(),
): Map<string, StepLabel> {
  const steps = fromEngineSteps(rows);
  return new Map(
    steps.map((step, i) => [
      step.key,
      {
        position: `${i + 1}/${steps.length}`,
        index: i + 1,
        total: steps.length,
        label: labelOf(step, templateNames),
      },
    ]),
  );
}
