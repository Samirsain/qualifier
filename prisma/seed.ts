import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  PERMISSIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  ROLES,
} from "../src/lib/rbac";
import { CUSTOMER_SOURCES, LEAD_STAGES } from "../src/lib/labels";
import { THREE_PERCENT_INTRODUCTION } from "./journeys";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  // Permissions
  for (const code of PERMISSIONS) {
    const [module, action] = code.split(":");
    await prisma.permission.upsert({
      where: { code },
      update: { module, action },
      create: { code, module, action },
    });
  }

  // Roles + role→permission mapping (Security §4 baseline)
  for (const code of ROLES) {
    const role = await prisma.role.upsert({
      where: { code },
      update: { name: ROLE_LABELS[code] },
      create: { code, name: ROLE_LABELS[code], systemRole: true },
    });
    const perms = await prisma.permission.findMany({
      where: { code: { in: [...ROLE_PERMISSIONS[code]] } },
      select: { id: true },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true,
    });
  }

  // Lead stages (BR-24 ten-stage pipeline)
  for (const [i, stage] of LEAD_STAGES.entries()) {
    await prisma.leadStage.upsert({
      where: { code: stage.code },
      update: { name: stage.name, sortOrder: i },
      create: { code: stage.code, name: stage.name, sortOrder: i },
    });
  }

  // Customer sources (BR-04)
  for (const source of CUSTOMER_SOURCES) {
    await prisma.source.upsert({
      where: { code: source.code },
      update: { name: source.name, type: source.type },
      create: { code: source.code, name: source.name, type: source.type },
    });
  }

  // Business configuration for still-open decisions. Nothing here is a
  // production value — each is a placeholder the business must approve.
  const settings: Record<string, unknown> = {
    "automation.pause_all": false, // BR-39 emergency control
    "automation.no_response_wait_hours": null, // GAP-002
    "reporting.timezone": null, // GAP-020
    "messaging.send_window": null, // GAP-021
    "followup.sla_hours": null, // GAP-014
    "customer.status_values": [], // GAP-006
    "meeting.status_values": [], // GAP-007
    "outcome.values": [], // GAP-008
    "customer.type_values": [], // GAP-032
    "optout.keywords": [], // GAP-018
  };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.systemSetting.upsert({
      where: { key },
      update: {},
      create: { key, value: value as never },
    });
  }

  // First administrator. Password policy is GAP-025 (TBD) — this is a local
  // development account only.
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@3percent.local";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: "ADMIN" } });
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      displayName: "Administrator",
      passwordHash: await bcrypt.hash(adminPassword, 12),
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
    update: {},
    create: { userId: admin.id, roleId: adminRole.id },
  });

  // The 3% Club introduction journey (DEV-009). Seeded as DRAFT — activation
  // is a business decision and requires passing validation first.
  const journey = THREE_PERCENT_INTRODUCTION;
  const existing = await prisma.automation.findFirst({
    where: { name: journey.name },
    select: { id: true },
  });

  if (!existing) {
    await prisma.automation.create({
      data: {
        name: journey.name,
        type: journey.type,
        status: "DRAFT",
        version: 1,
        description: journey.description,
        entryConditions: journey.entryConditions as never,
        createdById: admin.id,
        steps: {
          create: journey.steps.map((s) => ({
            version: 1,
            stepKey: s.stepKey,
            stepType: s.stepType,
            config: s.config as never,
            nextStepKey: s.nextStepKey ?? null,
            sortOrder: s.sortOrder,
          })),
        },
      },
    });
    console.log(`Seeded automation "${journey.name}" (${journey.steps.length} steps, DRAFT)`);
  }

  console.log(`Seed complete. Admin: ${adminEmail} / ${adminPassword}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
