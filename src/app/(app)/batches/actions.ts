"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { startBatch } from "@/lib/batches/runner";
import { parseNumberList, type ParseSummary } from "@/lib/numbers/parse-list";
import { prisma } from "@/lib/prisma";
import { assertPermission } from "@/lib/session";

export type PreviewState = { summary?: ParseSummary; text?: string; error?: string };
export type CreateState = { error?: string };

/**
 * Read the pasted list and report what it contains, before anything is sent.
 *
 * Parsing is pure and runs here rather than in the browser so the review the
 * user approves is the one the server will act on.
 */
export async function previewNumbers(
  _prev: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  await assertPermission("batch:manage");
  const text = String(formData.get("numbers") ?? "");
  if (!text.trim()) return { error: "Paste some numbers first.", text };
  return { summary: parseNumberList(text), text };
}

/**
 * Freeze the audience.
 *
 * The funnel version is copied onto the batch at creation, so editing the
 * funnel afterwards cannot change what this batch runs. Numbers that have
 * opted out become members with a reason rather than being dropped silently —
 * the count has to add up when someone asks why a number was never messaged.
 */
export async function createBatch(
  _prev: CreateState,
  formData: FormData,
): Promise<CreateState> {
  const user = await assertPermission("batch:manage");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Give the batch a name." };

  const automationId = z.uuid().safeParse(formData.get("automationId"));
  if (!automationId.success) return { error: "Choose a funnel." };

  const summary = parseNumberList(String(formData.get("numbers") ?? ""));
  if (summary.valid.length === 0) {
    return { error: "None of those rows is a number this can send to." };
  }

  const funnel = await prisma.automation.findUnique({
    where: { id: automationId.data },
    select: { id: true, status: true, version: true, name: true },
  });
  if (!funnel) return { error: "That funnel no longer exists." };
  if (funnel.status !== "ACTIVE") {
    return { error: `"${funnel.name}" is not active, so it cannot run a batch yet.` };
  }

  const batch = await prisma.batch.create({
    data: {
      name,
      automationId: funnel.id,
      automationVersion: funnel.version,
      status: "DRAFT",
      createdById: user.id,
    },
    select: { id: true },
  });

  for (const row of summary.valid) {
    const customer = await prisma.customer.upsert({
      where: { phoneE164: row.e164 },
      update: row.name ? { name: row.name } : {},
      create: { phoneE164: row.e164, name: row.name, batchId: batch.id },
      select: { id: true, optedOutAt: true },
    });

    await prisma.batchMember.upsert({
      where: { batchId_customerId: { batchId: batch.id, customerId: customer.id } },
      update: {},
      create: {
        batchId: batch.id,
        customerId: customer.id,
        skippedReason: customer.optedOutAt ? "opted out" : null,
      },
    });
  }

  await logActivity({
    actorUserId: user.id,
    eventType: "batch.created",
    objectType: "batch",
    objectId: batch.id,
    after: {
      name,
      funnel: funnel.name,
      members: summary.valid.length,
      rejected: summary.rejected.length,
      duplicates: summary.duplicateCount,
      countryAssumed: summary.assumedCountryCount,
    },
  });

  revalidatePath("/batches");
  redirect(`/batches/${batch.id}`);
}

/** Start sending. The first slice runs inline; the tick picks up the rest. */
export async function startBatchAction(formData: FormData) {
  const user = await assertPermission("batch:manage");
  const id = z.uuid().parse(formData.get("id"));

  await startBatch(id);

  await logActivity({
    actorUserId: user.id,
    eventType: "batch.start_requested",
    objectType: "batch",
    objectId: id,
  });

  revalidatePath(`/batches/${id}`);
  revalidatePath("/batches");
}

/**
 * Pause or stop a batch.
 *
 * Neither touches runs already in flight — a number that has been messaged
 * stays in its funnel. This only governs whether more numbers get enrolled.
 */
export async function setBatchStatus(formData: FormData) {
  const user = await assertPermission("batch:manage");
  const id = z.uuid().parse(formData.get("id"));
  const status = z.enum(["RUNNING", "PAUSED", "STOPPED"]).parse(formData.get("status"));

  const before = await prisma.batch.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!before || before.status === status) return;
  if (before.status === "COMPLETED" || before.status === "STOPPED") return;

  await prisma.batch.update({ where: { id }, data: { status } });

  await logActivity({
    actorUserId: user.id,
    eventType: `batch.${status.toLowerCase()}`,
    objectType: "batch",
    objectId: id,
    before: { status: before.status },
    after: { status },
  });

  revalidatePath(`/batches/${id}`);
  revalidatePath("/batches");
}
