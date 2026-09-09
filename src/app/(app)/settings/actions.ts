"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/session";
import { setSetting } from "@/lib/settings";

export type SettingsState = {
  error?: string;
  saved?: boolean;
};

/**
 * Comma separated in the box, a list of words in the database. Not exported:
 * a "use server" module may only export async functions.
 */
function parseOptOutWords(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(",")
        .map((word) => word.trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * An empty box writes an empty list, which is how the rule is switched off:
 * `inbound.ts` treats an empty list as "no word opts anyone out".
 */
export async function saveOptOutWords(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await assertPermission("settings:manage");
  const words = parseOptOutWords(String(formData.get("keywords") ?? ""));

  await setSetting("optout.keywords", words, user.id);
  revalidatePath("/settings");

  return { saved: true };
}

/** Emergency stop. The engine refuses to advance any run while this is true. */
export async function setPauseAllFromSettings(formData: FormData) {
  const user = await assertPermission("automation:pause_all");
  const paused = z.enum(["true", "false"]).parse(formData.get("paused")) === "true";

  await setSetting("automation.pause_all", paused, user.id);

  revalidatePath("/settings");
  revalidatePath("/funnels");
}
