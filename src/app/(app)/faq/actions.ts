"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { assertPermission } from "@/lib/session";

export type FaqState = {
  fieldErrors?: Record<string, string>;
  saved?: boolean;
};

const faqInput = z.object({
  id: z.union([z.uuid(), z.literal("")]).optional(),
  category: z.string().trim().min(1, "Category is required").max(60),
  question: z.string().trim().min(1, "Question is required").max(400),
  answer: z.string().trim().min(1, "Answer is required").max(4000),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});

export async function saveFaq(
  _prev: FaqState,
  formData: FormData,
): Promise<FaqState> {
  const user = await assertPermission("faq:manage");

  const parsed = faqInput.safeParse({
    id: formData.get("id") ?? "",
    category: formData.get("category"),
    question: formData.get("question"),
    answer: formData.get("answer"),
    sortOrder: formData.get("sortOrder") ?? 0,
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0])] ??= issue.message;
    }
    return { fieldErrors };
  }

  const { id, ...data } = parsed.data;
  const faq = id
    ? await prisma.faq.update({ where: { id }, data })
    : await prisma.faq.create({ data });

  await logActivity({
    actorUserId: user.id,
    eventType: id ? "faq.updated" : "faq.created",
    objectType: "faq",
    objectId: faq.id,
    after: { category: faq.category, question: faq.question },
  });

  revalidatePath("/faq");
  return { saved: true };
}

/** Activate / deactivate rather than delete — journeys may reference it. */
export async function setFaqActive(formData: FormData) {
  const user = await assertPermission("faq:manage");
  const id = z.uuid().parse(formData.get("id"));
  const active = formData.get("active") === "true";

  await prisma.faq.update({ where: { id }, data: { active } });

  await logActivity({
    actorUserId: user.id,
    eventType: active ? "faq.activated" : "faq.deactivated",
    objectType: "faq",
    objectId: id,
  });

  revalidatePath("/faq");
}
