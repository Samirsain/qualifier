import assert from "node:assert/strict";
import test from "node:test";
import { toEngineSteps, type BuilderStep } from "./steps";
import { stepLabels } from "./step-labels";

const TPL = "11111111-1111-4111-8111-111111111111";
const names = new Map([[TPL, "Intro"]]);

const funnel: BuilderStep[] = [
  { kind: "message", key: "s1", templateId: TPL },
  { kind: "wait", key: "s2", days: 1, hours: 2 },
  {
    kind: "question",
    key: "q1",
    templateId: TPL,
    prompt: "Interested?",
    questionKey: "interest",
    yesKey: "s4",
    noKey: "s5",
    otherKey: null,
    noReplyDays: 0,
    noReplyKey: null,
  },
  { kind: "qualify", key: "s4" },
  { kind: "stop", key: "s5", reason: "Not interested", status: "NOT_INTERESTED" },
];

test("every step key gets a position and a readable label", () => {
  const labels = stepLabels(toEngineSteps(funnel), names);
  assert.deepEqual(labels.get("s1"), {
    position: "1/5",
    index: 1,
    total: 5,
    label: "Message: Intro",
  });
  assert.deepEqual(labels.get("s2"), {
    position: "2/5",
    index: 2,
    total: 5,
    label: "Wait 1d 2h",
  });
  assert.deepEqual(labels.get("q1"), {
    position: "3/5",
    index: 3,
    total: 5,
    label: "Question: Interested?",
  });
  assert.equal(labels.get("s4")?.label, "Mark qualified");
  assert.equal(labels.get("s5")?.label, "Stop: Not interested");
});

test("an unknown template still names the step", () => {
  const labels = stepLabels(toEngineSteps([funnel[0]]), new Map());
  assert.equal(labels.get("s1")?.label, "Message: untitled");
});
