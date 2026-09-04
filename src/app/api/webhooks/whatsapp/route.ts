import { NextResponse, type NextRequest } from "next/server";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { whatsapp } from "@/lib/whatsapp/adapter";
import { ingestEvents } from "@/lib/whatsapp/inbound";

export const dynamic = "force-dynamic";

/** Provider subscription handshake. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const ok = whatsapp().verifyWebhook({
    mode: params.get("hub.mode"),
    token: params.get("hub.verify_token"),
  });

  if (!ok) return new NextResponse("Forbidden", { status: 403 });
  return new NextResponse(params.get("hub.challenge") ?? "", { status: 200 });
}

/**
 * Inbound webhook. Authenticity is verified before any business processing
 * (Security §8), and the provider is acknowledged even when individual events
 * are ignored, so it does not retry a payload we have already stored.
 */
export async function POST(request: NextRequest) {
  // Doc 11 §8 — rate limit by abuse risk. Generous, because a real provider
  // bursts legitimately; it exists to cap a flood, not to shape normal traffic.
  const limit = rateLimit(clientKey(request.headers, "webhook"), 600, 60);
  if (!limit.allowed) {
    return new NextResponse("Too Many Requests", {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfterSeconds) },
    });
  }

  const rawBody = await request.text();

  // Body-size cap (doc 11 §8). A provider payload is small; anything far
  // larger is not one.
  if (rawBody.length > 1_000_000) {
    return new NextResponse("Payload Too Large", { status: 413 });
  }

  const verified = whatsapp().verifyWebhook({
    signature: request.headers.get("x-hub-signature-256"),
    rawBody,
  });
  if (!verified) {
    console.warn("[whatsapp] webhook signature verification failed");
    return new NextResponse("Forbidden", { status: 403 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const events = whatsapp().parseWebhook(body);
  if (events.length === 0) return NextResponse.json({ ok: true, processed: 0 });

  try {
    const result = await ingestEvents(events);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // 5xx tells the provider to retry; dedupe makes that replay safe.
    console.error("[whatsapp] ingest failed", err);
    return new NextResponse("Ingest failed", { status: 500 });
  }
}
