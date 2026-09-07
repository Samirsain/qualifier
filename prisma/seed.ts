import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

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
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      displayName: "Administrator",
      role: "ADMIN",
      passwordHash: await bcrypt.hash(adminPassword, 12),
    },
  });

  console.log(`Seed complete. Admin: ${adminEmail} / ${adminPassword}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
