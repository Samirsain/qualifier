import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_SEGMENT,
  describeSegment,
  parseSegment,
  segmentDefinition,
  segmentToWhere,
} from "./segment";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

type Clause = Record<string, unknown>;
const clauses = (where: ReturnType<typeof segmentToWhere>) =>
  (where.AND as Clause[]) ?? [];

test("an empty segment still excludes opted-out customers", () => {
  const where = segmentToWhere(EMPTY_SEGMENT);
  assert.deepEqual(clauses(where), [{ optedOutAt: null }]);
});

test("the opt-out guard cannot be switched off by the definition", () => {
  // There is deliberately no field for it, so a crafted payload cannot drop it.
  const crafted = segmentDefinition.parse({
    optedOutAt: "anything",
    includeOptedOut: true,
    sourceIds: [UUID_A],
  });
  const where = segmentToWhere(crafted);
  assert.ok(
    clauses(where).some((c) => "optedOutAt" in c && c.optedOutAt === null),
    "opt-out exclusion must survive an unexpected payload",
  );
});

test("only the preview may lift the opt-out guard, for counting", () => {
  const where = segmentToWhere(EMPTY_SEGMENT, { includeOptedOut: true });
  assert.deepEqual(clauses(where), []);
});

test("each filter contributes exactly one clause", () => {
  const segment = segmentDefinition.parse({
    sourceIds: [UUID_A, UUID_B],
    interestStatuses: ["INTERESTED"],
    leadStageCodes: ["QUALIFIED"],
    customerTypes: ["existing"],
  });
  const found = clauses(segmentToWhere(segment));

  assert.deepEqual(
    found.find((c) => "sourceId" in c),
    { sourceId: { in: [UUID_A, UUID_B] } },
  );
  assert.deepEqual(
    found.find((c) => "interestStatus" in c),
    { interestStatus: { in: ["INTERESTED"] } },
  );
  assert.deepEqual(
    found.find((c) => "lead" in c),
    { lead: { stage: { code: { in: ["QUALIFIED"] } } } },
  );
  assert.deepEqual(
    found.find((c) => "customerType" in c),
    { customerType: { in: ["existing"] } },
  );
});

test("tag ALL requires every tag; tag ANY requires one", () => {
  const all = clauses(
    segmentToWhere(
      segmentDefinition.parse({ tagNames: ["vip", "warm"], tagMatch: "ALL" }),
    ),
  ).filter((c) => "tags" in c);
  // One `some` clause per tag — the only way AND-of-tags works in SQL.
  assert.equal(all.length, 2);

  const any = clauses(
    segmentToWhere(
      segmentDefinition.parse({ tagNames: ["vip", "warm"], tagMatch: "ANY" }),
    ),
  ).filter((c) => "tags" in c);
  assert.equal(any.length, 1);
  assert.deepEqual(any[0], {
    tags: { some: { tag: { name: { in: ["vip", "warm"] } } } },
  });
});

test("onlyUnassigned overrides a staff selection rather than combining", () => {
  const where = segmentToWhere(
    segmentDefinition.parse({
      assignedStaffIds: [UUID_A],
      onlyUnassigned: true,
    }),
  );
  const found = clauses(where).filter((c) => "assignedStaffId" in c);
  // Exactly one clause, and it is the null check — combining both would
  // produce an always-empty audience.
  assert.deepEqual(found, [{ assignedStaffId: null }]);
});

test("empty filter lists add no clause at all", () => {
  const segment = segmentDefinition.parse({
    sourceIds: [],
    tagNames: [],
    interestStatuses: [],
    leadStageCodes: [],
  });
  assert.deepEqual(clauses(segmentToWhere(segment)), [{ optedOutAt: null }]);
});

test("date bounds map to inclusive gte and lte", () => {
  const after = new Date("2026-01-01T00:00:00Z");
  const before = new Date("2026-02-01T00:00:00Z");
  const found = clauses(
    segmentToWhere(
      segmentDefinition.parse({ createdAfter: after, createdBefore: before }),
    ),
  ).filter((c) => "createdAt" in c);

  assert.deepEqual(found, [
    { createdAt: { gte: after } },
    { createdAt: { lte: before } },
  ]);
});

test("a malformed stored definition falls back to empty, never throws", () => {
  assert.deepEqual(parseSegment(null), EMPTY_SEGMENT);
  assert.deepEqual(parseSegment({ sourceIds: "not-an-array" }), EMPTY_SEGMENT);
  assert.deepEqual(parseSegment({ interestStatuses: ["NOPE"] }), EMPTY_SEGMENT);
});

test("an empty segment is described honestly, not as an empty list", () => {
  assert.deepEqual(describeSegment(EMPTY_SEGMENT), [
    "every customer who has not opted out",
  ]);
});

test("project or plot interest is not a segmentable field", () => {
  // GAP-033 leaves that data model undefined. If someone later adds the field
  // without the business decision, this fails and asks the question again.
  const keys = Object.keys(segmentDefinition.shape);
  assert.ok(!keys.some((k) => /project|plot/i.test(k)));
});
