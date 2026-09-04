import assert from "node:assert/strict";
import test from "node:test";
import { THREE_PERCENT_INTRODUCTION as J } from "./journeys";
import {
  actionConfig,
  branchConfig,
  normaliseAnswer,
  waitConfig,
} from "../src/lib/automation/types";

const steps = new Map(J.steps.map((s) => [s.stepKey, s]));

function outgoing(stepKey: string): string[] {
  const step = steps.get(stepKey);
  if (!step) return [];
  const out: string[] = [];
  if (step.nextStepKey) out.push(step.nextStepKey);
  if (step.stepType === "BRANCH") {
    const parsed = branchConfig.parse(step.config);
    out.push(...Object.values(parsed.answers));
    if (parsed.otherStepKey) out.push(parsed.otherStepKey);
    if (parsed.timeoutStepKey) out.push(parsed.timeoutStepKey);
  }
  return out;
}

test("every step config parses against its schema", () => {
  for (const step of J.steps) {
    if (step.stepType === "ACTION") actionConfig.parse(step.config);
    if (step.stepType === "WAIT") waitConfig.parse(step.config);
    if (step.stepType === "BRANCH") branchConfig.parse(step.config);
  }
});

test("no step points at a target that does not exist", () => {
  for (const step of J.steps) {
    for (const target of outgoing(step.stepKey)) {
      assert.ok(
        steps.has(target),
        `step "${step.stepKey}" targets missing step "${target}"`,
      );
    }
  }
});

test("every step is reachable from the trigger", () => {
  const seen = new Set<string>();
  const queue = ["start"];
  while (queue.length > 0) {
    const key = queue.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    queue.push(...outgoing(key));
  }
  for (const step of J.steps) {
    assert.ok(seen.has(step.stepKey), `step "${step.stepKey}" is unreachable`);
  }
});

// ---- The critical NO rule (doc 07 §7, doc 17 §10) ----

test("first NO stops the information journey and marks for revision", () => {
  const ask = branchConfig.parse(steps.get("ask_more")!.config);
  assert.equal(ask.answers.NO, "no_record");

  // record → status → tag → wait, in that order
  assert.equal(steps.get("no_record")!.nextStepKey, "no_status");

  const status = actionConfig.parse(steps.get("no_status")!.config);
  assert.equal(status.action, "change_customer_status");
  assert.equal(
    status.action === "change_customer_status" && status.interestStatus,
    "REVISIT_LATER",
  );

  assert.equal(steps.get("no_tag")!.nextStepKey, "wait_one_day");

  // The NO path never re-sends the introduction.
  const noPathSends = ["no_record", "no_status", "no_tag"].filter((key) => {
    const cfg = actionConfig.parse(steps.get(key)!.config);
    return cfg.action === "send_message";
  });
  assert.deepEqual(noPathSends, []);
});

test("the revision wait is exactly one day, not a configurable guess", () => {
  const step = steps.get("wait_one_day")!;
  assert.equal(step.stepType, "WAIT");

  const wait = waitConfig.parse(step.config);
  assert.equal(wait.days, 1);
  assert.equal(wait.hours, undefined);
  // Must not be settings-driven — "exactly one day" is a source requirement,
  // not a business preference that can be tuned away.
  assert.equal(wait.settingKey, undefined);
  assert.equal(step.nextStepKey, "revision_ask");
});

test("revision YES re-enters the information journey without repeating the intro", () => {
  const revision = branchConfig.parse(steps.get("revision_ask")!.config);
  assert.equal(revision.answers.YES, "revision_yes");

  // It rejoins at the interested/benefits step, never at "intro".
  assert.equal(steps.get("revision_yes")!.nextStepKey, "yes_mark_interested");
  assert.notEqual(steps.get("revision_yes")!.nextStepKey, "intro");
});

test("second NO stops the journey and cannot send another message", () => {
  const revision = branchConfig.parse(steps.get("revision_ask")!.config);
  assert.equal(revision.answers.NO, "second_no_record");

  // Walk the whole second-NO tail and assert it terminates in a stop with no
  // send_message anywhere along it. This is the "do not repeatedly send the
  // same message" requirement, enforced structurally.
  const tail: string[] = [];
  let key: string | null | undefined = "second_no_record";
  while (key) {
    tail.push(key);
    const cfg = actionConfig.parse(steps.get(key)!.config);
    assert.notEqual(
      cfg.action,
      "send_message",
      `second-NO path must not message again (step "${key}")`,
    );
    if (cfg.action === "stop_journey") break;
    key = steps.get(key)!.nextStepKey;
  }

  const last = actionConfig.parse(steps.get(tail.at(-1)!)!.config);
  assert.equal(last.action, "stop_journey");

  const status = actionConfig.parse(steps.get("second_no_status")!.config);
  assert.equal(
    status.action === "change_customer_status" && status.interestStatus,
    "NOT_INTERESTED",
  );
});

test("no-response wait reads its duration from settings, never a constant", () => {
  const ask = branchConfig.parse(steps.get("ask_more")!.config);
  // GAP-002 is undecided — the journey must not hard-code a wait.
  assert.equal(ask.timeout?.settingKey, "automation.no_response_wait_hours");
  assert.equal(ask.timeout?.days, undefined);
  assert.equal(ask.timeout?.hours, undefined);
  assert.equal(ask.timeoutStepKey, "no_response_followup");
});

test("unrecognised replies go to a human, not into a branch", () => {
  for (const key of ["ask_more", "revision_ask", "ask_representative"]) {
    const branch = branchConfig.parse(steps.get(key)!.config);
    assert.equal(
      branch.otherStepKey,
      "handoff_unclear",
      `branch "${key}" must hand unrecognised replies to staff`,
    );
  }
});

test("answers normalise to YES and NO from text and button ids", () => {
  assert.equal(normaliseAnswer("yes"), "YES");
  assert.equal(normaliseAnswer("  No  "), "NO");
  assert.equal(normaliseAnswer("Y"), "YES");
  assert.equal(normaliseAnswer("Yes please", "intro_yes"), "YES");
  assert.equal(normaliseAnswer("Not right now", "intro_no"), "NO");
  // Anything else stays itself, so the branch falls through to otherStepKey.
  assert.equal(normaliseAnswer("tell me the price"), "TELL ME THE PRICE");
  assert.equal(normaliseAnswer(""), "");
});
