import assert from "node:assert/strict";
import test from "node:test";
import { blankConfig, readyForActivation, type ScoringConfig } from "./config";
import { calculateScore, rankable } from "./calculate";
import { emptyFactorValues, FACTOR_KEYS, FACTORS } from "./factors";

/** A config that would pass the activation gate — used only inside tests. */
function approvableConfig(overrides: Partial<ScoringConfig> = {}): ScoringConfig {
  const config = blankConfig();
  config.factors.follow_ups_completed = {
    enabled: true,
    weight: 10,
    normalisation: "PER_ASSIGNED",
    cap: null,
    target: null,
  };
  config.factors.follow_ups_overdue = {
    enabled: true,
    weight: 5,
    normalisation: "PER_ASSIGNED",
    cap: null,
    target: null,
  };
  config.approvalNote = "Approved for testing only.";
  return { ...config, ...overrides };
}

// ---- The activation gate (doc 13 §4) ----

test("a blank configuration cannot be activated", () => {
  const problems = readyForActivation(blankConfig());
  assert.ok(problems.length > 0);
  assert.ok(problems.some((p) => /no factor is enabled/i.test(p)));
});

test("an enabled factor without a weight blocks activation", () => {
  const config = blankConfig();
  config.factors.calls_handled = {
    enabled: true,
    weight: null,
    normalisation: "PER_ASSIGNED",
    cap: null,
    target: null,
  };
  config.approvalNote = "note";
  assert.ok(
    readyForActivation(config).some((p) => /no approved weight/i.test(p)),
  );
});

test("all-raw-count configurations are refused, per doc 13 §4", () => {
  const config = blankConfig();
  config.factors.follow_ups_completed = {
    enabled: true,
    weight: 1,
    normalisation: "RAW",
    cap: null,
    target: null,
  };
  config.approvalNote = "note";
  assert.ok(
    readyForActivation(config).some((p) => /favours larger workloads/i.test(p)),
    "a plain sum of raw counts must not be activatable",
  );
});

test("a cap or target without its value blocks activation", () => {
  const capped = blankConfig();
  capped.factors.calls_handled = {
    enabled: true,
    weight: 1,
    normalisation: "CAPPED",
    cap: null,
    target: null,
  };
  capped.approvalNote = "note";
  assert.ok(readyForActivation(capped).some((p) => /no cap value/i.test(p)));

  const targeted = blankConfig();
  targeted.factors.calls_handled = {
    enabled: true,
    weight: 1,
    normalisation: "PER_TARGET",
    cap: null,
    target: null,
  };
  targeted.approvalNote = "note";
  assert.ok(readyForActivation(targeted).some((p) => /no target is set/i.test(p)));
});

test("activation requires a recorded approval note", () => {
  const config = approvableConfig({ approvalNote: undefined });
  assert.ok(readyForActivation(config).some((p) => /who approved/i.test(p)));
});

test("the reference approvable config passes the gate", () => {
  assert.deepEqual(readyForActivation(approvableConfig()), []);
});

// ---- Calculation refuses without approval ----

test("no score is produced from an unapprovable configuration", () => {
  const result = calculateScore(blankConfig(), emptyFactorValues(), {
    assignedCustomers: 10,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.problems.length > 0);
});

// ---- Arithmetic ----

test("negative factors subtract and positives add", () => {
  const values = emptyFactorValues();
  values.follow_ups_completed = 8;
  values.follow_ups_overdue = 2;

  const result = calculateScore(approvableConfig(), values, { assignedCustomers: 4 });
  assert.ok(result.ok);
  if (!result.ok) return;

  // completed: 8/4 = 2 × 10 = +20 ; overdue: 2/4 = 0.5 × 5 × -1 = -2.5
  assert.equal(result.score, 17.5);

  const overdue = result.contributions.find((c) => c.key === "follow_ups_overdue");
  assert.equal(overdue?.direction, "NEGATIVE");
  assert.ok(overdue!.contribution < 0);
});

test("per-assigned normalisation stops workload alone from winning", () => {
  const busy = emptyFactorValues();
  busy.follow_ups_completed = 20;
  const small = emptyFactorValues();
  small.follow_ups_completed = 5;

  const busyResult = calculateScore(approvableConfig(), busy, {
    assignedCustomers: 40,
  });
  const smallResult = calculateScore(approvableConfig(), small, {
    assignedCustomers: 5,
  });

  assert.ok(busyResult.ok && smallResult.ok);
  if (!busyResult.ok || !smallResult.ok) return;
  // 20/40 = 0.5 vs 5/5 = 1.0 — the smaller book completed a higher share.
  assert.ok(smallResult.score > busyResult.score);
});

test("zero assigned customers does not divide by zero", () => {
  const values = emptyFactorValues();
  values.follow_ups_completed = 3;
  const result = calculateScore(approvableConfig(), values, { assignedCustomers: 0 });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(Number.isFinite(result.score), true);
  assert.equal(result.score, 0);
});

test("a cap clips the raw value before weighting", () => {
  const config = blankConfig();
  config.factors.calls_handled = {
    enabled: true,
    weight: 2,
    normalisation: "CAPPED",
    cap: 5,
    target: null,
  };
  config.approvalNote = "note";

  const values = emptyFactorValues();
  values.calls_handled = 100;

  const result = calculateScore(config, values, { assignedCustomers: 10 });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.score, 10); // min(100, 5) × 2
});

test("the score is clamped at zero only when configured", () => {
  const values = emptyFactorValues();
  values.follow_ups_overdue = 10;

  const allowed = calculateScore(approvableConfig(), values, { assignedCustomers: 1 });
  assert.ok(allowed.ok);
  if (allowed.ok) assert.ok(allowed.score < 0);

  const clamped = calculateScore(
    approvableConfig({ allowNegativeTotal: false }),
    values,
    { assignedCustomers: 1 },
  );
  assert.ok(clamped.ok);
  if (clamped.ok) {
    assert.equal(clamped.score, 0);
    assert.equal(clamped.clampedAtZero, true);
  }
});

test("every contribution states its own derivation", () => {
  const values = emptyFactorValues();
  values.follow_ups_completed = 4;

  const result = calculateScore(approvableConfig(), values, { assignedCustomers: 2 });
  assert.ok(result.ok);
  if (!result.ok) return;

  for (const c of result.contributions) {
    // Doc 13 §10 — period, config, raw, normalisation, weight, contribution.
    assert.equal(typeof c.raw, "number");
    assert.equal(typeof c.normalised, "number");
    assert.equal(typeof c.weight, "number");
    assert.equal(typeof c.contribution, "number");
    assert.ok(c.normalisation.length > 0);
  }
});

// ---- Ranking guard (doc 13 §8) ----

test("ranking is withheld when anyone is below the sample size", () => {
  const config = approvableConfig({ minimumSampleSize: 10 });
  const busy = emptyFactorValues();
  busy.follow_ups_completed = 50;
  const quiet = emptyFactorValues();
  quiet.follow_ups_completed = 1;

  const ranked = rankable([
    { staffId: "a", result: calculateScore(config, busy, { assignedCustomers: 10 }) },
    { staffId: "b", result: calculateScore(config, quiet, { assignedCustomers: 10 }) },
  ]);

  assert.ok("blocked" in ranked);
});

test("ranking sorts descending when every score is comparable", () => {
  const config = approvableConfig();
  const high = emptyFactorValues();
  high.follow_ups_completed = 10;
  const low = emptyFactorValues();
  low.follow_ups_completed = 2;

  const ranked = rankable([
    { staffId: "low", result: calculateScore(config, low, { assignedCustomers: 5 }) },
    { staffId: "high", result: calculateScore(config, high, { assignedCustomers: 5 }) },
  ]);

  assert.ok(Array.isArray(ranked));
  if (!Array.isArray(ranked)) return;
  assert.equal(ranked[0].staffId, "high");
});

// ---- The factor set matches the source ----

test("all twelve source-defined factors are present with a direction", () => {
  assert.equal(FACTOR_KEYS.length, 12);
  const negatives = FACTOR_KEYS.filter((k) => FACTORS[k].direction === "NEGATIVE");
  // Doc 13 §2 names exactly two negative factors.
  assert.deepEqual(negatives.sort(), ["assigned_no_action", "follow_ups_overdue"]);
  for (const key of FACTOR_KEYS) {
    assert.ok(FACTORS[key].measure.length > 0, `${key} needs a stated measure`);
  }
});
