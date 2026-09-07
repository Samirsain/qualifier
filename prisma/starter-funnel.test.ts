import assert from "node:assert/strict";
import test from "node:test";
import { STARTER_FUNNEL } from "./starter-funnel";
import { validateBuilderSteps, toEngineSteps } from "../src/lib/funnels/steps";

const TPL = "11111111-1111-4111-8111-111111111111";

/** The seed fills every message step's template in; validate the same shape. */
const seeded = STARTER_FUNNEL.steps.map((s) =>
  s.kind === "message" || s.kind === "question" ? { ...s, templateId: TPL } : s,
);

test("the starter funnel is valid once the seed fills in its templates", () => {
  assert.deepEqual(validateBuilderSteps(seeded), []);
});

test("it ends by qualifying someone", () => {
  assert.ok(STARTER_FUNNEL.steps.some((s) => s.kind === "qualify"));
});

test("saying no never leads to being qualified", () => {
  const byKey = new Map(STARTER_FUNNEL.steps.map((s) => [s.key, s]));
  const question = STARTER_FUNNEL.steps.find((s) => s.kind === "question");
  assert.ok(question && question.kind === "question");

  // Walk the NO path and assert it cannot reach a qualify step.
  const seen = new Set<string>();
  const queue = [question.noKey].filter(Boolean) as string[];
  while (queue.length) {
    const key = queue.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    const step = byKey.get(key);
    assert.ok(step, `step ${key} exists`);
    assert.notEqual(step!.kind, "qualify", `NO path must not qualify (${key})`);
    if (step!.kind === "question") {
      for (const t of [step!.yesKey, step!.noKey, step!.otherKey]) {
        if (t) queue.push(t);
      }
    }
  }
});

test("it converts to engine steps without throwing", () => {
  const rows = toEngineSteps(STARTER_FUNNEL.steps);
  assert.equal(rows.length, STARTER_FUNNEL.steps.length);
});
