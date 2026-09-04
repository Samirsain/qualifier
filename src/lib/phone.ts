/**
 * Phone parsing for number upload.
 *
 * The default country is India, because in practice almost every number loaded
 * will be Indian. A bare number is only completed to +91 when it matches a real
 * Indian mobile shape — exactly ten digits beginning 6, 7, 8 or 9 — so a
 * ten-digit number that is not a plausible mobile is rejected rather than
 * silently given a country code and messaged.
 *
 * An explicit country code is always honoured.
 */

export type ParsedPhone =
  | { ok: true; e164: string; assumedCountry: boolean }
  | { ok: false; reason: string };

export type SupportedCountry = "IN";

/** Indian mobile: 10 digits, first digit 6-9. */
const IN_MOBILE = /^[6-9]\d{9}$/;

/** E.164: + then 8 to 15 digits, first digit not zero. */
const E164 = /^\+[1-9]\d{7,14}$/;

export function parsePhone(
  raw: string,
  defaultCountry: SupportedCountry = "IN",
): ParsedPhone {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return { ok: false, reason: "empty" };

  // Strip the separators people actually paste.
  const cleaned = trimmed.replace(/[\s()\-.]/g, "");

  if (/[^\d+]/.test(cleaned)) {
    return { ok: false, reason: "contains characters that are not digits" };
  }

  if (cleaned.startsWith("+")) {
    if (!E164.test(cleaned)) {
      return { ok: false, reason: "not a valid international number" };
    }
    return { ok: true, e164: cleaned, assumedCountry: false };
  }

  if (/\+/.test(cleaned)) {
    return { ok: false, reason: "misplaced +" };
  }

  const digits = cleaned;

  if (defaultCountry === "IN") {
    // 91XXXXXXXXXX — the country code is present, just without the plus.
    if (digits.length === 12 && digits.startsWith("91")) {
      const national = digits.slice(2);
      if (!IN_MOBILE.test(national)) {
        return { ok: false, reason: "not a valid Indian mobile number" };
      }
      return { ok: true, e164: `+91${national}`, assumedCountry: false };
    }

    // 0XXXXXXXXXX — national dialling prefix.
    if (digits.length === 11 && digits.startsWith("0")) {
      const national = digits.slice(1);
      if (!IN_MOBILE.test(national)) {
        return { ok: false, reason: "not a valid Indian mobile number" };
      }
      return { ok: true, e164: `+91${national}`, assumedCountry: true };
    }

    if (digits.length === 10) {
      if (!IN_MOBILE.test(digits)) {
        return {
          ok: false,
          reason: "not a valid Indian mobile number (must start 6, 7, 8 or 9)",
        };
      }
      return { ok: true, e164: `+91${digits}`, assumedCountry: true };
    }

    return {
      ok: false,
      reason: `expected 10 digits for an Indian mobile, got ${digits.length}`,
    };
  }

  return { ok: false, reason: "unsupported default country" };
}
