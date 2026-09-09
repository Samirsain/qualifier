import "server-only";
import { prisma } from "@/lib/prisma";
import { whatsapp, type SendResult } from "@/lib/whatsapp/adapter";
import {
  fillPlaceholders,
  unfilledPlaceholders,
} from "@/lib/whatsapp/placeholders";

/**
 * Outbound flow (doc 10 §8): validate eligibility → persist send intent →
 * call the provider → persist the normalized result.
 *
 * The intent row is written *before* the provider call so an accepted message
 * is never lost when the process dies mid-request.
 */

export type SendOutcome =
  | { ok: true; messageId: string }
  | { ok: false; reason: string };

export async function sendToCustomer(input: {
  customerId: string;
  actorUserId?: string;
  body?: string;
  templateId?: string;
}): Promise<SendOutcome> {
  const customer = await prisma.customer.findUnique({
    where: { id: input.customerId },
    select: { id: true, phoneE164: true, optedOutAt: true, name: true },
  });
  if (!customer) return { ok: false, reason: "Customer not found." };

  // Respect exit paths (BR-49/BR-54, GAP-018 keyword policy still open).
  if (customer.optedOutAt) {
    return { ok: false, reason: "This customer has opted out of messaging." };
  }

  const template = input.templateId
    ? await prisma.template.findUnique({
        where: { id: input.templateId },
        select: {
          id: true,
          body: true,
          providerTemplateKey: true,
          language: true,
          approvalStatus: true,
          active: true,
          archivedAt: true,
        },
      })
    : null;

  if (input.templateId && !template) {
    return { ok: false, reason: "Template not found." };
  }
  if (template && (!template.active || template.archivedAt)) {
    return { ok: false, reason: "That template is archived or inactive." };
  }

  const raw = template?.body ?? input.body?.trim();
  if (!raw) return { ok: false, reason: "Message body is empty." };

  const text = fillPlaceholders(raw, { name: customer.name });
  // A leftover {{placeholder}} would go out to a real person as-is. Refusing is
  // the only honest option: the message is wrong, and half-sending it is worse
  // than not sending it.
  const unfilled = unfilledPlaceholders(text);
  if (unfilled.length > 0) {
    return {
      ok: false,
      reason: `Message still contains ${unfilled.join(", ")}. Fill it in or remove it from the template.`,
    };
  }

  const conversation =
    (await prisma.conversation.findFirst({
      where: { customerId: customer.id, channel: "whatsapp", status: "OPEN" },
      select: { id: true },
    })) ??
    (await prisma.conversation.create({
      data: { customerId: customer.id, channel: "whatsapp" },
      select: { id: true },
    }));

  // Send intent, persisted before the provider call.
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      customerId: customer.id,
      direction: "OUTBOUND",
      type: template ? "TEMPLATE" : "TEXT",
      templateId: template?.id,
      body: text,
      deliveryStatus: "QUEUED",
    },
    select: { id: true },
  });

  let result: SendResult;
  if (template?.providerTemplateKey) {
    result = await whatsapp().send({
      kind: "template",
      to: customer.phoneE164,
      templateKey: template.providerTemplateKey,
      language: template.language ?? "en",
    });
  } else {
    result = await whatsapp().send({
      kind: "text",
      to: customer.phoneE164,
      body: text,
    });
  }

  if (!result.ok) {
    await prisma.message.update({
      where: { id: message.id },
      data: {
        deliveryStatus: "FAILED",
        failedAt: new Date(),
        failureCode: result.code,
      },
    });
    await prisma.activityLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        eventType: "whatsapp.send_failed",
        objectType: "message",
        objectId: message.id,
        customerId: customer.id,
        metadata: { code: result.code, retryable: result.retryable },
      },
    });
    return { ok: false, reason: result.message };
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.message.update({
      where: { id: message.id },
      data: {
        providerMessageId: result.providerMessageId,
        deliveryStatus: "SENT",
        sentAt: now,
      },
    }),
    prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: now },
    }),
    prisma.customer.update({
      where: { id: customer.id },
      data: { lastInteractionAt: now },
    }),
    prisma.activityLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        eventType: "whatsapp.message_sent",
        objectType: "message",
        objectId: message.id,
        customerId: customer.id,
        metadata: { templateId: template?.id ?? null },
      },
    }),
  ]);

  return { ok: true, messageId: message.id };
}
