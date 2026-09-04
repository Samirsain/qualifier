import assert from "node:assert/strict";
import test from "node:test";
import {
  activeDimensions,
  analyticsFilters,
  parseFilters,
  resolvePeriod,
} from "./filters";
import {
  METRICS,
  METRIC_KEYS,
  METRIC_LIST,
  isComputable,
  metricsInGroup,
} from "./definitions";

const NOW = new Date("2026-09-04T14:30:00");

// ---- Period boundaries (doc 12 §2) ----

test("TODAY starts at midnight and ends now", () => {
  const p = resolvePeriod(analyticsFilters.parse({ range: "TODAY" }), NOW);
  assert.equal(p.start.getHours(), 0);
  assert.equal(p.start.getDate(), NOW.getDate());
  assert.equal(p.end.getTime(), NOW.getTime());
});

test("LAST_7 covers seven days inclusive of today", () => {
  const p = resolvePeriod(analyticsFilters.parse({ range: "LAST_7" }), NOW);
  const expectedStart = new Date(NOW);
  expectedStart.setDate(expectedStart.getDate() - 6);
  expectedStart.setHours(0, 0, 0, 0);

  // Today plus the six days before it, starting at midnight.
  assert.equal(p.start.getTime(), expectedStart.getTime());
  assert.equal(p.end.getTime(), NOW.getTime());
});

test("THIS_MONTH starts on the first of the month", () => {
  const p = resolvePeriod(analyticsFilters.parse({ range: "THIS_MONTH" }), NOW);
  assert.equal(p.start.getDate(), 1);
  assert.equal(p.start.getMonth(), NOW.getMonth());
});

test("LAST_MONTH cannot overlap this month", () => {
  const last = resolvePeriod(analyticsFilters.parse({ range: "LAST_MONTH" }), NOW);
  const current = resolvePeriod(analyticsFilters.parse({ range: "THIS_MONTH" }), NOW);

  assert.equal(last.start.getMonth(), NOW.getMonth() - 1);
  assert.equal(last.start.getDate(), 1);
  // A record must never be counted in both periods.
  assert.ok(last.end < current.start, "last month must end before this month starts");
  assert.equal(last.end.getMilliseconds(), 999);
});

test("ALL starts at the epoch rather than an invented lookback", () => {
  const p = resolvePeriod(analyticsFilters.parse({ range: "ALL" }), NOW);
  assert.equal(p.start.getTime(), 0);
});

test("a reversed custom range is corrected, not returned empty", () => {
  const p = resolvePeriod(
    analyticsFilters.parse({
      range: "CUSTOM",
      from: "2026-09-30",
      to: "2026-09-01",
    }),
    NOW,
  );
  assert.ok(p.start < p.end, "start must precede end even when the user swaps them");
});

test("a custom range covers whole days at both ends", () => {
  const p = resolvePeriod(
    analyticsFilters.parse({
      range: "CUSTOM",
      from: "2026-09-01",
      to: "2026-09-02",
    }),
    NOW,
  );
  assert.equal(p.start.getHours(), 0);
  assert.equal(p.end.getHours(), 23);
  assert.equal(p.end.getMinutes(), 59);
});

// ---- Filters ----

test("only applied dimensions are reported as active", () => {
  assert.deepEqual(activeDimensions(analyticsFilters.parse({})), []);
  assert.deepEqual(
    activeDimensions(
      analyticsFilters.parse({
        sourceId: "11111111-1111-4111-8111-111111111111",
        leadStageCode: "QUALIFIED",
      }),
    ),
    ["source", "lead stage"],
  );
});

test("a malformed filter set falls back to defaults instead of throwing", () => {
  const parsed = parseFilters({ range: "NONSENSE", sourceId: "not-a-uuid" });
  assert.equal(parsed.range, "LAST_30");
  assert.equal(parsed.sourceId, "");
});

// ---- Metric definition contract (doc 12 §1) ----

test("every metric states population, numerator and time field", () => {
  for (const m of METRIC_LIST) {
    assert.ok(m.population.length > 0, `${m.key} needs a population`);
    assert.ok(m.numerator.length > 0, `${m.key} needs a numerator`);
    assert.ok(m.timeField.length > 0, `${m.key} needs a time field`);
  }
});

test("every rate states its denominator", () => {
  // If a metric name implies a ratio, it must say what it divides by.
  const rates = METRIC_LIST.filter((m) => /rate/i.test(m.label));
  assert.ok(rates.length > 0);
  for (const m of rates) {
    assert.ok(m.denominator, `${m.key} is a rate and must state a denominator`);
  }
});

test("metric keys and the registry cannot drift apart", () => {
  assert.equal(METRIC_LIST.length, METRIC_KEYS.length);
  for (const key of METRIC_KEYS) {
    assert.equal(METRICS[key].key, key, `${key} is registered under the wrong key`);
  }
});

test("every metric belongs to exactly one group", () => {
  const groups = ["customer", "communication", "lead", "staff", "campaign", "automation"] as const;
  const seen = groups.flatMap((g) => metricsInGroup(g).map((m) => m.key));
  assert.equal(seen.length, METRIC_KEYS.length);
  assert.equal(new Set(seen).size, METRIC_KEYS.length);
});

test("an undefined KPI is not computable and carries its reason", () => {
  // GAP-012 — the source names Active Customers but never defines it.
  assert.equal(isComputable("active_customers"), false);
  assert.ok(METRICS.active_customers.pendingDecision);
  assert.match(METRICS.active_customers.pendingDecision!, /GAP-012/);
});

test("a stand-in measure is computed but flagged, not hidden", () => {
  // Converted uses stage entry because GAP-009 leaves the criteria open. It
  // still produces a number — it just says what the number actually means.
  assert.equal(isComputable("converted"), true);
  assert.ok(METRICS.converted.pendingDecision);
  assert.match(METRICS.converted.pendingDecision!, /GAP-009/);
});
