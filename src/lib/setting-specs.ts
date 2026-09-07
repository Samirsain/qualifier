/**
 * The business decisions that live in `system_settings`.
 *
 * Each entry names the GAP it resolves and states what the system does while
 * it is unset — so an operator can see the cost of leaving a decision open,
 * rather than discovering it when a journey silently does nothing.
 */

export type SettingType = "number" | "timezone" | "list" | "text";

export type SettingSpec = {
  key: string;
  label: string;
  gap: string;
  type: SettingType;
  unit?: string;
  help: string;
  /** What happens while this is null. */
  whileUnset: string;
};

export const SETTING_SPECS = [
  {
    key: "automation.no_response_wait_hours",
    label: "No-response wait",
    gap: "GAP-002",
    type: "number",
    unit: "hours",
    help: "How long to wait for a customer reply before sending the configured follow-up.",
    whileUnset:
      "Any journey with a no-response branch fails validation and cannot be activated. The 3% Club introduction journey is currently blocked by this.",
  },
  {
    key: "reporting.timezone",
    label: "Reporting timezone",
    gap: "GAP-020",
    type: "timezone",
    help: "IANA zone used for date boundaries in analytics, e.g. Asia/Kolkata.",
    whileUnset:
      "Analytics period boundaries use the server timezone, so date-based figures are not anchored to an approved business day.",
  },
  {
    key: "optout.keywords",
    label: "Opt-out keywords",
    gap: "GAP-018",
    type: "list",
    help: "Comma separated. A customer sending any of these is suppressed from all messaging.",
    whileUnset:
      "No keyword suppresses anyone. A customer replying STOP is treated as an ordinary unrecognised reply and handed to staff.",
  },
  {
    key: "messaging.send_window",
    label: "Send window",
    gap: "GAP-021",
    type: "text",
    help: 'Allowed hours for outbound messages, e.g. "09:00-20:00".',
    whileUnset: "Messages can be sent at any hour of the day.",
  },
  {
    key: "numbers.default_country",
    label: "Default country for bare numbers",
    gap: "Decided",
    type: "text",
    help: 'Two-letter code. Numbers without a country code are completed with this. Currently only "IN" is supported.',
    whileUnset:
      "Numbers without a country code are rejected instead of being completed.",
  },
] as const satisfies readonly SettingSpec[];

export type SettingKey = (typeof SETTING_SPECS)[number]["key"];

/**
 * The same list widened to the common shape. `as const` gives us the literal
 * key union above, but it also narrows each entry so optional fields like
 * `unit` only exist on some members — this is what UI code iterates.
 */
export const SETTING_FIELDS: readonly SettingSpec[] = SETTING_SPECS;

/** Render a stored value back into its form field. */
export function toFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}
