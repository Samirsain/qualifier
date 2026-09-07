import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { tick } from "@/lib/automation/worker";
import { dispatchRunningBatches } from "@/lib/batches/runner";

export const dynamic = "force-dynamic";

/**
 * Drives the durable timer worker. Call it on a schedule — a platform cron,
 * a container sidecar, or `curl` in a loop for local development:
 *
 *   curl -H "Authorization: Bearer $AUTOMATION_TICK_SECRET" \
 *        http://localhost:3000/api/automation/tick
 *
 * Ticking more often than the shortest wait is harmless: claiming is
 * transactional and every effect is idempotent.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.AUTOMATION_TICK_SECRET;
  if (!secret) {
    return new NextResponse("AUTOMATION_TICK_SECRET is not set", { status: 503 });
  }

  const provided = request.headers.get("authorization")?.replace("Bearer ", "") ?? "";
  const expected = Buffer.from(secret);
  const actual = Buffer.from(provided);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    const automations = await tick();
    const batches = await dispatchRunningBatches();
    return NextResponse.json({ automations, batches });
  } catch (err) {
    console.error("[tick] failed", err);
    return new NextResponse("Tick failed", { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
