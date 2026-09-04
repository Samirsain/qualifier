"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/session";
import { setSetting } from "@/lib/settings";
import { SETTING_SPECS, type SettingKey } from "@/lib/setting-specs";

export type SettingsState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  saved?: boolean;
};

/**
 * Record a business decision (doc 19 — resolving a GAP).
 *
 * An empty value writes `null`, which is how a decision is *un-made*. That
 * matters: if a value turns out to be wrong, the correct action is to clear it
 * and let the affected feature refuse to run, not to leave a bad number live.
 */
export async function saveSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await assertPermission("settings:manage");

  const fieldErrors: Record<string, string> = {};
  const updates: { key: SettingKey; value: unknown }[] = [];

  for (const spec of SETTING_SPECS) {
    if (!formData.has(spec.key)) continue;
    const raw = String(formData.get(spec.key) ?? "").trim();

    if (raw === "") {
      updates.push({ key: spec.key, value: null });
      continue;
    }

    switch (spec.type) {
      case "number": {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) {
          fieldErrors[spec.key] = "Enter a number of zero or more.";
          continue;
        }
        updates.push({ key: spec.key, value: n });
        break;
      }
      case "timezone": {
        try {
          new Intl.DateTimeFormat("en", { timeZone: raw });
        } catch {
          fieldErrors[spec.key] = "Not a recognised IANA timezone, e.g. Asia/Kolkata.";
          continue;
        }
        updates.push({ key: spec.key, value: raw });
        break;
      }
      case "list": {
        const list = raw
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);
        updates.push({ key: spec.key, value: list });
        break;
      }
      case "text":
      default:
        updates.push({ key: spec.key, value: raw });
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  for (const update of updates) {
    await setSetting(update.key, update.value, user.id);
  }

  // Timing and policy values change how journeys behave, so every surface
  // that reads them is refreshed.
  revalidatePath("/settings");
  revalidatePath("/automations");

  return { saved: true };
}

/** Emergency pause-all, mirrored here so admins have one operations screen. */
export async function setPauseAllFromSettings(formData: FormData) {
  const user = await assertPermission("automation:pause_all");
  const paused = z.enum(["true", "false"]).parse(formData.get("paused")) === "true";

  await setSetting("automation.pause_all", paused, user.id);

  revalidatePath("/settings");
  revalidatePath("/automations");
}
