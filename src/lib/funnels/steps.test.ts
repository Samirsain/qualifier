import assert from "node:assert/strict";
import test from "node:test";
import {
  toEngineSteps,
  fromEngineSteps,
  validateBuilderSteps,
  type BuilderStep,
} from "./steps";

const TPL = "11111111-1111-4111-8111-111111111111";

const simple: BuilderStep[] = [
  { kind: "message", key: "s1", templateId: TPL },
  { kind: "wait", key: "s2", days: 1, hours: 0 },
  { kind: "qualify", key: "s3" },
];

test("a linear funnel chains each step to the next", () => {
  const rows = toEngineSteps(simple);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].nextStepKey, "s2");
  assert.equal(rows[1].nextStepKey, "s3");
  // The last step ends the funnel.
  assert.equal(rows[2].nextStepKey, null);
});

test("step kinds map to the engine's own types", () => {
  const rows = toEngineSteps(simple);
  assert.equal(rows[0].stepType, "ACTION");
  assert.equal(rows[1].stepType, "WAIT");
  assert.equal(rows[2].stepType, "ACTION");
  assert.deepEqual(rows[2].config, { action: "mark_qualified" });
});

test("a question becomes a BRANCH and does not use nextStepKey", () => {
  const steps: BuilderStep[] = [
    {
      kind: "question",
      key: "q1",
      templateId: TPL,
      prompt: "Would you like to know more?",
      questionKey: "wants_more",
      yesKey: "y1",
      noKey: "n1",
      otherKey: "n1",
    },
    { kind: "qualify", key: "y1" },
    { kind: "message", key: "n1", templateId: TPL },
  ];

  const rows = toEngineSteps(steps);
  const q = rows[0];
  assert.equal(q.stepType, "BRANCH");
  // Branch targets are explicit, so an implicit "next" would be a second,
  // conflicting path out of the same step.
  assert.equal(q.nextStepKey, null);

  const cfg = q.config as { answers: Record<string, string>; otherStepKey: string };
  assert.deepEqual(cfg.answers, { YES: "y1", NO: "n1" });
  assert.equal(cfg.otherStepKey, "n1");
});

test("sortOrder is stable and ten apart, leaving room to insert", () => {
  const rows = toEngineSteps(simple);
  assert.deepEqual(rows.map((r) => r.sortOrder), [0, 10, 20]);
});

test("a round trip through the engine shape preserves the builder steps", () => {
  const rows = toEngineSteps(simple).map((r) => ({ ...r, version: 1 }));
  assert.deepEqual(fromEngineSteps(rows), simple);
});

test("validation rejects a funnel with no qualify step", () => {
  const problems = validateBuilderSteps([
    { kind: "message", key: "s1", templateId: TPL },
  ]);
  assert.ok(problems.some((p) => /qualify/i.test(p)));
});

test("validation rejects a branch pointing at a missing step", () => {
  const problems = validateBuilderSteps([
    {
      kind: "question",
      key: "q1",
      templateId: TPL,
      prompt: "?",
      questionKey: "k",
      yesKey: "nope",
      noKey: null,
      otherKey: null,
    },
    { kind: "qualify", key: "z" },
  ]);
  assert.ok(problems.some((p) => /nope/.test(p)));
});

test("validation rejects duplicate step keys", () => {
  const problems = validateBuilderSteps([
    { kind: "message", key: "dup", templateId: TPL },
    { kind: "qualify", key: "dup" },
  ]);
  assert.ok(problems.some((p) => /duplicate/i.test(p)));
});

test("validation rejects a zero-length wait", () => {
  const problems = validateBuilderSteps([
    { kind: "wait", key: "w", days: 0, hours: 0 },
    { kind: "qualify", key: "q" },
  ]);
  assert.ok(problems.some((p) => /zero/i.test(p)));
});

test("an empty funnel is rejected", () => {
  assert.ok(validateBuilderSteps([]).length > 0);
});

test("a stop step terminates and carries its reason", () => {
  const rows = toEngineSteps([
    { kind: "qualify", key: "q" },
    { kind: "stop", key: "end", reason: "done" },
  ]);
  assert.equal(rows[1].stepType, "ACTION");
  assert.deepEqual(rows[1].config, { action: "stop_journey", reason: "done" });
  assert.equal(rows[1].nextStepKey, null);
});
