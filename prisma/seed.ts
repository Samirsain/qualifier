import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { STARTER_FUNNEL } from "./starter-funnel";
import { toEngineSteps } from "../src/lib/funnels/steps";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  // Business configuration for still-open decisions. Nothing here is a
  // production value — each is a placeholder the business must approve.
  const settings: Record<string, unknown> = {
    "automation.pause_all": false,
    "automation.no_response_wait_hours": null, // decision pending
    "numbers.default_country": "IN", // decided
    "reporting.timezone": null, // decision pending
    "optout.keywords": [], // decision pending
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

  // One template per message step, so the starter funnel is usable immediately.
  const introTemplate = await prisma.template.upsert({
    where: { name: "Starter — introduction" },
    update: {},
    create: {
      name: "Starter — introduction",
      category: "Starter",
      body: "Hello {{name}}, thanks for your interest. May we tell you more?",
    },
  });

  const existing = await prisma.automation.findFirst({
    where: { name: STARTER_FUNNEL.name },
    select: { id: true },
  });

  if (!existing) {
    const withTemplate = STARTER_FUNNEL.steps.map((s) =>
      s.kind === "message" || s.kind === "question"
        ? { ...s, templateId: introTemplate.id }
        : s,
    );
    await prisma.automation.create({
      data: {
        name: STARTER_FUNNEL.name,
        type: STARTER_FUNNEL.type,
        status: "DRAFT",
        version: 1,
        description: STARTER_FUNNEL.description,
        createdById: admin.id,
        steps: {
          create: toEngineSteps(withTemplate).map((r) => ({
            version: 1,
            stepKey: r.stepKey,
            stepType: r.stepType,
            config: r.config as never,
            nextStepKey: r.nextStepKey,
            sortOrder: r.sortOrder,
          })),
        },
      },
    });
  }

  console.log(`Seed complete. Admin: ${adminEmail} / ${adminPassword}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
