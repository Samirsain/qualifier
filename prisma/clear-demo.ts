import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

/**
 * Removes the three demo batches and every number in them.
 *
 * Deleting a customer cascades to its batch membership, runs, events,
 * conversations and responses, so the customers go first and the now-empty
 * batches after. Prints what it found and stops there unless --yes is passed:
 * this deletes real rows, and a wrong database is one env var away.
 */
const DEMO_BATCHES = ["Diwali list — October", "Sept warm list", "Referrals — Q3"];

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const batches = await prisma.batch.findMany({
    where: { name: { in: DEMO_BATCHES } },
    select: { id: true, name: true },
  });

  if (batches.length === 0) {
    console.log("No demo batches found — nothing to clear.");
    return;
  }

  const batchIds = batches.map((b) => b.id);
  const members = await prisma.batchMember.findMany({
    where: { batchId: { in: batchIds } },
    select: { customerId: true },
  });
  const customerIds = [...new Set(members.map((m) => m.customerId))];

  for (const b of batches) console.log(`  batch: ${b.name}`);
  console.log(`  numbers: ${customerIds.length}`);

  if (!process.argv.includes("--yes")) {
    console.log("\nNothing deleted. Re-run with --yes to delete these.");
    return;
  }

  const customers = await prisma.customer.deleteMany({
    where: { id: { in: customerIds } },
  });
  const removed = await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
  console.log(`\nDeleted ${customers.count} numbers and ${removed.count} batches.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
