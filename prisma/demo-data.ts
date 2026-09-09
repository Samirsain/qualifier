import type { PrismaClient } from "../src/generated/prisma/client";

/**
 * Demo batches, so every screen has something real to show.
 *
 * The shape matters more than the volume: each batch has numbers in every
 * state, at different steps, with timers in the future and replies in the
 * past — which is the only way the tracking table, the distribution bars and
 * the "new since last export" split can be judged at all.
 *
 * Deterministic on purpose (a fixed generator, fixed offsets from `now`), so
 * two people seeding get the same list and a screenshot stays comparable.
 * Skipped entirely once any batch exists, so it never touches real work.
 */

const FIRST = [
  "Priya", "Rakesh", "Anita", "Farhan", "Suresh", "Meera", "Devendra", "Kavita",
  "Imran", "Nisha", "Arjun", "Sneha", "Vikram", "Fatima", "Rohit", "Lakshmi",
  "Sanjay", "Divya", "Tarun", "Ayesha", "Manish", "Pooja", "Gaurav", "Ritu",
];
const LAST = [
  "Nair", "Menon", "Deshpande", "Qureshi", "Iyer", "Joshi", "Patil", "Sharma",
  "Khan", "Reddy", "Bose", "Gupta", "Chauhan", "Sheikh", "Verma", "Rao",
];

/** A tiny LCG: same seed, same demo list, on every machine. */
function generator(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

type StateKey =
  | "IN_FUNNEL"
  | "QUALIFIED"
  | "NOT_INTERESTED"
  | "NO_RESPONSE"
  | "NOT_STARTED";

/**
 * Where a number in each state sits in the starter funnel, and the path it
 * took to get there. `path` becomes one event per step, which is what the
 * batch screen reads to show how many steps a number has been through.
 */
const RUNS: Record<
  Exclude<StateKey, "NOT_STARTED">,
  {
    stepKey: string;
    state: "WAITING" | "STOPPED";
    stopReason?: string;
    path: string[];
  }[]
> = {
  IN_FUNNEL: [
    { stepKey: "ask_more", state: "WAITING", path: ["intro", "ask_more"] },
    {
      stepKey: "ask_call",
      state: "WAITING",
      path: ["intro", "ask_more", "details", "ask_call"],
    },
  ],
  QUALIFIED: [
    {
      stepKey: "end_qualified",
      state: "STOPPED",
      stopReason: "qualified for the CRM team",
      path: ["intro", "ask_more", "details", "ask_call", "qualified", "end_qualified"],
    },
  ],
  NOT_INTERESTED: [
    {
      stepKey: "end_declined",
      state: "STOPPED",
      stopReason: "not interested",
      path: ["intro", "ask_more", "declined", "end_declined"],
    },
  ],
  NO_RESPONSE: [
    {
      stepKey: "end_no_reply",
      state: "STOPPED",
      stopReason: "no reply within three days",
      path: ["intro", "ask_more", "end_no_reply"],
    },
  ],
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type BatchSpec = {
  name: string;
  status: "RUNNING" | "PAUSED" | "COMPLETED";
  startedDaysAgo: number;
  /** How many numbers land in each state. */
  split: Record<StateKey, number>;
  skipped: number;
  /** Of the qualified, how many were already handed to the CRM team. */
  exported: number;
};

const BATCHES: BatchSpec[] = [
  {
    name: "Diwali list — October",
    status: "PAUSED",
    startedDaysAgo: 4,
    split: { NOT_STARTED: 8, IN_FUNNEL: 14, QUALIFIED: 7, NOT_INTERESTED: 5, NO_RESPONSE: 4 },
    skipped: 2,
    exported: 0,
  },
  {
    name: "Sept warm list",
    status: "RUNNING",
    startedDaysAgo: 11,
    split: { NOT_STARTED: 3, IN_FUNNEL: 12, QUALIFIED: 13, NOT_INTERESTED: 9, NO_RESPONSE: 7 },
    skipped: 1,
    exported: 11,
  },
  {
    name: "Referrals — Q3",
    status: "COMPLETED",
    startedDaysAgo: 26,
    split: { NOT_STARTED: 0, IN_FUNNEL: 0, QUALIFIED: 6, NOT_INTERESTED: 7, NO_RESPONSE: 4 },
    skipped: 0,
    exported: 6,
  },
];

export async function seedDemoData(
  prisma: PrismaClient,
  input: { adminId: string; automationId: string; automationVersion: number },
) {
  if ((await prisma.batch.count()) > 0) return { created: 0 };

  const random = generator(20260908);
  const now = Date.now();
  let phoneSeq = 0;
  let created = 0;

  const nextPhone = () => {
    phoneSeq += 1;
    // Reserved test range, so no demo number can belong to a real person.
    return `+9199${String(70000000 + phoneSeq * 137).slice(0, 8)}`;
  };
  const maybeName = () =>
    random() < 0.78
      ? `${FIRST[Math.floor(random() * FIRST.length)]} ${LAST[Math.floor(random() * LAST.length)]}`
      : null;

  for (const spec of BATCHES) {
    const startedAt = new Date(now - spec.startedDaysAgo * DAY);
    const batch = await prisma.batch.create({
      data: {
        name: spec.name,
        automationId: input.automationId,
        automationVersion: input.automationVersion,
        status: spec.status,
        createdById: input.adminId,
        startedAt,
        ...(spec.status === "COMPLETED" && {
          completedAt: new Date(now - (spec.startedDaysAgo - 5) * DAY),
        }),
      },
    });

    let exportedLeft = spec.exported;

    for (const [state, count] of Object.entries(spec.split) as [StateKey, number][]) {
      for (let i = 0; i < count; i++) {
        const enrolledAt =
          state === "NOT_STARTED"
            ? null
            : new Date(startedAt.getTime() + random() * 6 * HOUR);
        const lastInteractionAt = enrolledAt
          ? new Date(enrolledAt.getTime() + random() * 2 * DAY)
          : null;
        const qualifiedAt = state === "QUALIFIED" ? lastInteractionAt : null;
        const exportedAt =
          state === "QUALIFIED" && exportedLeft > 0
            ? (exportedLeft--, new Date(now - 2 * DAY))
            : null;

        const customer = await prisma.customer.create({
          data: {
            phoneE164: nextPhone(),
            name: maybeName(),
            status: state,
            batchId: batch.id,
            lastInteractionAt,
            qualifiedAt,
            exportedAt,
          },
        });
        await prisma.batchMember.create({
          data: { batchId: batch.id, customerId: customer.id, enrolledAt },
        });
        created += 1;

        if (state === "NOT_STARTED") continue;

        const shape = RUNS[state][Math.floor(random() * RUNS[state].length)];
        const run = await prisma.automationRun.create({
          data: {
            automationId: input.automationId,
            automationVersion: input.automationVersion,
            customerId: customer.id,
            state: shape.state,
            currentStepKey: shape.stepKey,
            enteredAt: enrolledAt ?? startedAt,
            // A waiting number is waiting for a reply until its no-reply
            // timer fires; a stopped one has nothing left to fire.
            nextActionAt:
              shape.state === "WAITING"
                ? new Date(now + (random() * 2.5 + 0.2) * DAY)
                : null,
            ...(shape.state === "STOPPED" && {
              stoppedAt: lastInteractionAt,
              stopReason: shape.stopReason,
            }),
          },
        });

        // One event per step actually taken, spread between enrolling and the
        // last thing that happened, so the journey reads in order.
        const from = (enrolledAt ?? startedAt).getTime();
        const to = (lastInteractionAt ?? enrolledAt ?? startedAt).getTime();
        await prisma.automationEvent.createMany({
          data: shape.path.map((stepKey, i) => ({
            runId: run.id,
            stepKey,
            eventType: "step.executed",
            occurredAt: new Date(
              from + ((to - from) * (i + 1)) / (shape.path.length + 1),
            ),
          })),
        });
      }
    }

    for (let i = 0; i < spec.skipped; i++) {
      const customer = await prisma.customer.create({
        data: { phoneE164: nextPhone(), name: maybeName(), status: "NOT_STARTED" },
      });
      await prisma.batchMember.create({
        data: {
          batchId: batch.id,
          customerId: customer.id,
          skippedReason: "already in an earlier batch",
        },
      });
      created += 1;
    }
  }

  return { created };
}
