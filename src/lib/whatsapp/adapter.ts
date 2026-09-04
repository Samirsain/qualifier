import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * WhatsApp provider adapter (doc 10 §6, doc 08 architecture).
 *
 * The BSP is GAP-022 — TBD Technical/Commercial Decision. Business logic talks
 * only to this interface, so swapping the provider is one file. `mock` is the
 * default so the product runs, and is testable, before that decision lands.
 */

export type OutboundText = {
  kind: "text";
  to: string;
  body: string;
};

export type OutboundTemplate = {
  kind: "template";
  to: string;
  templateKey: string;
  language: string;
  variables?: Record<string, string>;
};

export type OutboundMessage = OutboundText | OutboundTemplate;

export type SendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; code: string; message: string; retryable: boolean };

/** Normalized inbound event — provider payload shapes never leak past here. */
export type InboundEvent =
  | {
      kind: "message";
      providerMessageId: string;
      from: string;
      receivedAt: Date;
      /** Plain text, or the title of a tapped button/list row. */
      text: string;
      /** Set when the customer tapped a structured reply. */
      replyId?: string;
      raw: unknown;
    }
  | {
      kind: "status";
      providerMessageId: string;
      status: "SENT" | "DELIVERED" | "READ" | "FAILED";
      at: Date;
      failureCode?: string;
      raw: unknown;
    };

export interface WhatsAppAdapter {
  readonly name: string;
  send(message: OutboundMessage): Promise<SendResult>;
  /** Parse a provider webhook body into normalized events. */
  parseWebhook(body: unknown): InboundEvent[];
  /** Verify webhook authenticity before any business processing (§6). */
  verifyWebhook(input: {
    mode?: string | null;
    token?: string | null;
    signature?: string | null;
    rawBody?: string;
  }): boolean;
}

// ---------------------------------------------------------------------------
// Mock adapter — records the send and fabricates a provider id.
// ---------------------------------------------------------------------------

const mockAdapter: WhatsAppAdapter = {
  name: "mock",

  async send(message) {
    console.info("[whatsapp:mock] send", {
      kind: message.kind,
      to: message.to.slice(0, 5) + "…", // never log full customer numbers (§5)
    });
    return { ok: true, providerMessageId: `mock-${crypto.randomUUID()}` };
  },

  parseWebhook(body) {
    return metaAdapter.parseWebhook(body);
  },

  /**
   * Even in development the webhook is not open.
   *
   * Accepting any unsigned POST would let anyone who knows the URL inject
   * inbound messages, which advance automations and cause real outbound
   * sends — doc 15 §6 classes that as S1 (uncontrolled customer messaging,
   * security bypass). A shared secret is required instead.
   */
  verifyWebhook({ mode, token, signature, rawBody }) {
    const expected = process.env.WHATSAPP_VERIFY_TOKEN;
    if (!expected) return false;

    if (mode === "subscribe") return token === expected;

    // Local testing signs the body with the verify token, the same shape the
    // real provider uses, so the ingest path is exercised identically.
    if (!signature?.startsWith("sha256=") || !rawBody) return false;
    const digest = createHmac("sha256", expected).update(rawBody).digest("hex");
    const provided = signature.slice("sha256=".length);
    if (digest.length !== provided.length) return false;
    return timingSafeEqual(Buffer.from(digest), Buffer.from(provided));
  },
};

// ---------------------------------------------------------------------------
// Meta WhatsApp Business Platform (Cloud API).
// ---------------------------------------------------------------------------

const GRAPH_VERSION = "v21.0";

type MetaChange = {
  value?: {
    messages?: {
      id?: string;
      from?: string;
      timestamp?: string;
      type?: string;
      text?: { body?: string };
      button?: { text?: string; payload?: string };
      interactive?: {
        button_reply?: { id?: string; title?: string };
        list_reply?: { id?: string; title?: string };
      };
    }[];
    statuses?: {
      id?: string;
      status?: string;
      timestamp?: string;
      errors?: { code?: number | string; title?: string }[];
    }[];
  };
};

function toDate(timestamp?: string): Date {
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : new Date();
}

const metaAdapter: WhatsAppAdapter = {
  name: "meta",

  async send(message) {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneNumberId) {
      return {
        ok: false,
        code: "provider_not_configured",
        message: "WhatsApp credentials are not set.",
        retryable: false,
      };
    }

    const payload =
      message.kind === "text"
        ? {
            messaging_product: "whatsapp",
            to: message.to,
            type: "text",
            text: { body: message.body },
          }
        : {
            messaging_product: "whatsapp",
            to: message.to,
            type: "template",
            template: {
              name: message.templateKey,
              language: { code: message.language },
              ...(message.variables && {
                components: [
                  {
                    type: "body",
                    parameters: Object.values(message.variables).map((text) => ({
                      type: "text",
                      text,
                    })),
                  },
                ],
              }),
            },
          };

    try {
      const res = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      const json = (await res.json()) as {
        messages?: { id?: string }[];
        error?: { code?: number; message?: string; type?: string };
      };

      if (!res.ok || json.error) {
        return {
          ok: false,
          code: String(json.error?.code ?? res.status),
          message: json.error?.message ?? "Provider rejected the message.",
          // 429 and 5xx are worth retrying; a rejected template is not.
          retryable: res.status === 429 || res.status >= 500,
        };
      }

      const providerMessageId = json.messages?.[0]?.id;
      if (!providerMessageId) {
        return {
          ok: false,
          code: "no_message_id",
          message: "Provider accepted the request without a message id.",
          retryable: false,
        };
      }
      return { ok: true, providerMessageId };
    } catch (err) {
      return {
        ok: false,
        code: "network_error",
        message: err instanceof Error ? err.message : "Request failed.",
        retryable: true,
      };
    }
  },

  parseWebhook(body) {
    const events: InboundEvent[] = [];
    const entries =
      (body as { entry?: { changes?: MetaChange[] }[] } | undefined)?.entry ?? [];

    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        for (const m of change.value?.messages ?? []) {
          if (!m.id || !m.from) continue;
          const reply = m.interactive?.button_reply ?? m.interactive?.list_reply;
          events.push({
            kind: "message",
            providerMessageId: m.id,
            from: m.from.startsWith("+") ? m.from : `+${m.from}`,
            receivedAt: toDate(m.timestamp),
            text: reply?.title ?? m.button?.text ?? m.text?.body ?? "",
            replyId: reply?.id ?? m.button?.payload,
            raw: m,
          });
        }

        for (const s of change.value?.statuses ?? []) {
          if (!s.id || !s.status) continue;
          const status = s.status.toUpperCase();
          if (!["SENT", "DELIVERED", "READ", "FAILED"].includes(status)) continue;
          events.push({
            kind: "status",
            providerMessageId: s.id,
            status: status as "SENT" | "DELIVERED" | "READ" | "FAILED",
            at: toDate(s.timestamp),
            failureCode: s.errors?.[0]?.code
              ? String(s.errors[0].code)
              : undefined,
            raw: s,
          });
        }
      }
    }

    return events;
  },

  verifyWebhook({ mode, token, signature, rawBody }) {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

    // Subscription handshake.
    if (mode === "subscribe") {
      return Boolean(verifyToken) && token === verifyToken;
    }

    // Payload signature. Rejects unsigned traffic when a secret is configured.
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    if (!appSecret) return false;
    if (!signature?.startsWith("sha256=") || !rawBody) return false;

    const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
    const provided = signature.slice("sha256=".length);
    if (expected.length !== provided.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  },
};

const ADAPTERS: Record<string, WhatsAppAdapter> = {
  mock: mockAdapter,
  meta: metaAdapter,
};

export function whatsapp(): WhatsAppAdapter {
  const name = process.env.WHATSAPP_PROVIDER ?? "mock";
  const adapter = ADAPTERS[name];
  if (!adapter) throw new Error(`Unknown WHATSAPP_PROVIDER: ${name}`);
  return adapter;
}
