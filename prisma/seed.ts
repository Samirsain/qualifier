import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { seedDemoData } from "./demo-data";
import { STARTER_FUNNEL } from "./starter-funnel";
import { toEngineSteps } from "../src/lib/funnels/steps";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  // The only two settings any code reads.
  const settings: Record<string, unknown> = {
    "automation.pause_all": false,
    "optout.keywords": [], // no word opts anyone out until one is set
  };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.systemSetting.upsert({
      where: { key },
      update: {},
      create: { key, value: value as never },
    });
  }

  // First administrator. Local development account only.
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@3percent.local";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      displayName: "Administrator",
      role: "ADMIN",
      passwordHash: await bcrypt.hash(adminPassword, 12),
    },
  });

  /*
   * One template per step, not one for the whole funnel: the tracking screen
   * names the step by its template, so sharing one made every message step
   * read "Starter — introduction" and the journey unreadable.
   */
  const COPY: Record<string, { name: string; body: string }> = {
    intro: {
      name: "Starter — introduction",
      body: "Hello {{name}}, thanks for your interest in the 3% Club.",
    },
    ask_more: {
      name: "Starter — know more?",
      body: "Would you like to know more? Reply YES or NO.",
    },
    details: {
      name: "Starter — the details",
      body:
        "Here is how it works: we share the details, answer your questions, and if it looks right for you, someone from our team calls. Replace this with your own wording.",
    },
    ask_call: {
      name: "Starter — call request",
      body: "Would you like someone to call you? Reply YES or NO.",
    },
    declined: {
      name: "Starter — no thank you",
      body: "Understood — we will not message you about this again.",
    },
  };

  const templateIds: Record<string, string> = {};
  for (const [stepKey, copy] of Object.entries(COPY)) {
    const template = await prisma.template.upsert({
      where: { name: copy.name },
      update: {},
      create: { name: copy.name, category: "Starter", body: copy.body },
    });
    templateIds[stepKey] = template.id;
  }

  let starter = await prisma.automation.findFirst({
    where: { name: STARTER_FUNNEL.name },
    select: { id: true, version: true },
  });

  const stepsFor = () =>
    toEngineSteps(
      STARTER_FUNNEL.steps.map((step) =>
        step.kind === "message" || step.kind === "question"
          ? { ...step, templateId: templateIds[step.key] ?? templateIds.intro }
          : step,
      ),
    ).map((r) => ({
      version: 1,
      stepKey: r.stepKey,
      stepType: r.stepType,
      config: r.config as never,
      nextStepKey: r.nextStepKey,
      sortOrder: r.sortOrder,
    }));

  // A funnel seeded before the no-reply path existed cannot show a silent
  // number going anywhere, so refresh its steps rather than leave it stale.
  if (starter) {
    const current = await prisma.automationStep.findMany({
      where: { automationId: starter.id },
      select: { stepKey: true, config: true },
    });
    const wanted = stepsFor();
    const stale =
      current.length !== wanted.length ||
      wanted.some((step) => {
        const match = current.find((c) => c.stepKey === step.stepKey);
        if (!match) return true;
        const before = (match.config as { templateId?: string })?.templateId;
        const after = (step.config as { templateId?: string })?.templateId;
        return before !== after;
      });

    if (stale) {
      await prisma.automationStep.deleteMany({ where: { automationId: starter.id } });
      await prisma.automationStep.createMany({
        data: wanted.map((step) => ({ ...step, automationId: starter!.id })),
      });
      console.log("Starter funnel refreshed: steps and per-step templates.");
    }
  }

  if (!starter) {
    starter = await prisma.automation.create({
      select: { id: true, version: true },
      data: {
        name: STARTER_FUNNEL.name,
        type: STARTER_FUNNEL.type,
        // Live, because a demo batch has to run against something.
        status: "ACTIVE",
        activatedAt: new Date(),
        version: 1,
        description: STARTER_FUNNEL.description,
        createdById: admin.id,
        steps: { create: stepsFor() },
      },
    });
  }

  // Demo numbers are a development convenience, never something a real
  // account should start with: 102 invented +9199… numbers would fail on every
  // send. Opt in with SEED_DEMO=true.
  const demo =
    process.env.SEED_DEMO === "true"
      ? await seedDemoData(prisma, {
          adminId: admin.id,
          automationId: starter.id,
          automationVersion: starter.version,
        })
      : { created: 0 };

  console.log(
    `Seed complete. Admin: ${adminEmail} / ${adminPassword}` +
      (demo.created > 0
        ? ` — ${demo.created} demo numbers across ${3} batches.`
        : " — no demo data (set SEED_DEMO=true for it)."),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
