"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { assertPermission } from "@/lib/session";

export type TemplateState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  saved?: boolean;
};

const templateInput = z.object({
  id: z.union([z.uuid(), z.literal("")]).optional(),
  name: z.string().trim().min(1, "Name is required").max(120),
  category: z.string().trim().min(1, "Category is required").max(60),
  body: z.string().trim().min(1, "Body is required").max(4000),
  providerTemplateKey: z.string().trim().max(120).optional(),
  language: z.string().trim().max(12).optional(),
  approvalStatus: z.string().trim().max(40).optional(),
});

export async function saveTemplate(
  _prev: TemplateState,
  formData: FormData,
): Promise<TemplateState> {
  const user = await assertPermission("template:manage");

  const parsed = templateInput.safeParse({
    id: formData.get("id") ?? "",
    name: formData.get("name"),
    category: formData.get("category"),
    body: formData.get("body"),
    providerTemplateKey: formData.get("providerTemplateKey") ?? "",
    language: formData.get("language") ?? "",
    approvalStatus: formData.get("approvalStatus") ?? "",
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0])] ??= issue.message;
    }
    return { fieldErrors };
  }

  const { id, ...data } = parsed.data;
  const payload = {
    name: data.name,
    category: data.category,
    body: data.body,
    providerTemplateKey: data.providerTemplateKey || null,
    language: data.language || null,
    // GAP-027: provider lifecycle states are not defined by the source, so the
    // value is stored as entered rather than validated against invented states.
    approvalStatus: data.approvalStatus || null,
  };

  const clash = await prisma.template.findFirst({
    where: { name: payload.name, ...(id && { NOT: { id } }) },
    select: { id: true },
  });
  if (clash) {
    return { fieldErrors: { name: "A template with this name already exists." } };
  }

  const template = id
    ? await prisma.template.update({ where: { id }, data: payload })
    : await prisma.template.create({ data: payload });

  await logActivity({
    actorUserId: user.id,
    eventType: id ? "template.updated" : "template.created",
    objectType: "template",
    objectId: template.id,
    after: { name: template.name, category: template.category },
  });

  revalidatePath("/templates");
  return { saved: true };
}

/** Duplicate, archive/restore and deactivate (BR-22). Delete is not offered —
 *  templates are referenced by message history. */
export async function duplicateTemplate(formData: FormData) {
  const user = await assertPermission("template:manage");
  const id = z.uuid().parse(formData.get("id"));

  const source = await prisma.template.findUniqueOrThrow({ where: { id } });
  const copy = await prisma.template.create({
    data: {
      name: `${source.name} (copy)`.slice(0, 120),
      category: source.category,
      body: source.body,
      providerTemplateKey: null, // a copy is not the approved provider template
      language: source.language,
      approvalStatus: null,
      structure: source.structure ?? undefined,
    },
  });

  await logActivity({
    actorUserId: user.id,
    eventType: "template.duplicated",
    objectType: "template",
    objectId: copy.id,
    metadata: { sourceId: id },
  });

  revalidatePath("/templates");
}

export async function setTemplateArchived(formData: FormData) {
  const user = await assertPermission("template:manage");
  const id = z.uuid().parse(formData.get("id"));
  const archived = formData.get("archived") === "true";

  const before = await prisma.template.findUniqueOrThrow({
    where: { id },
    select: { archivedAt: true, active: true },
  });

  await prisma.template.update({
    where: { id },
    data: {
      archivedAt: archived ? new Date() : null,
      active: !archived,
    },
  });

  await logActivity({
    actorUserId: user.id,
    eventType: archived ? "template.archived" : "template.restored",
    objectType: "template",
    objectId: id,
    before: { archivedAt: before.archivedAt, active: before.active },
  });

  revalidatePath("/templates");
}
