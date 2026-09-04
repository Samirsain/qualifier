import { z } from "zod";
import { FACTOR_KEYS, type FactorKey } from "@/lib/scoring/factors";

/**
 * Scoring configuration model (doc 13 §3).
 *
 * Each factor configuration carries: identifier, enabled flag, weight, raw
 * measure (defined in `factors.ts`), optional cap and normalisation method,
 * direction, and the approving owner on the config itself.
 *
 * Nothing in this file has a default weight. A config with unset weights is
 * structurally valid as a *draft* but cannot be activated — see
 * `readyForActivation` below.
 */

/** Doc 13 §5 — the normalisation basis management must choose. */
export const normalisationMethod = z.enum([
  /** Raw count. Doc 13 §4 warns this favours larger workloads. */
  "RAW",
  /** Value ÷ assigned customers in the period. */
  "PER_ASSIGNED",
  /** Value ÷ an approved target for the period. */
  "PER_TARGET",
  /** Raw count, clipped at `cap`. */
  "CAPPED",
]);

export type NormalisationMethod = z.infer<typeof normalisationMethod>;

export const factorConfig = z.object({
  enabled: z.boolean().default(false),
  /** Null means "management has not set this yet" — not zero. */
  weight: z.number().min(-1000).max(1000).nullable().default(null),
  normalisation: normalisationMethod.default("RAW"),
  /** Required by CAPPED, ignored otherwise. */
  cap: z.number().min(0).max(100000).nullable().default(null),
  /** Required by PER_TARGET, ignored otherwise. */
  target: z.number().min(0).max(100000).nullable().default(null),
});

export type FactorConfig = z.infer<typeof factorConfig>;

export const scoringConfig = z.object({
  factors: z.record(z.enum(FACTOR_KEYS), factorConfig),
  /** Doc 13 §5 — may a negative factor push the score below zero? */
  allowNegativeTotal: z.boolean().default(true),
  /** Doc 13 §5 — minimum measured activity before a staff member is ranked. */
  minimumSampleSize: z.number().int().min(0).max(10000).default(0),
  /** Doc 13 §5 — the final score range, if management caps it. */
  scoreCeiling: z.number().min(0).max(100000).nullable().default(null),
  /** Free-text note recording what management approved and why. */
  approvalNote: z.string().max(2000).optional(),
});

export type ScoringConfig = z.infer<typeof scoringConfig>;

/** A blank config: every factor present, disabled, no weight assigned. */
export function blankConfig(): ScoringConfig {
  return {
    factors: Object.fromEntries(
      FACTOR_KEYS.map((k) => [
        k,
        { enabled: false, weight: null, normalisation: "RAW" as const, cap: null, target: null },
      ]),
    ) as Record<FactorKey, FactorConfig>,
    allowNegativeTotal: true,
    minimumSampleSize: 0,
    scoreCeiling: null,
  };
}

export function parseConfig(value: unknown): ScoringConfig {
  const parsed = scoringConfig.safeParse(value);
  if (!parsed.success) return blankConfig();
  // Ensure every factor key exists even if the stored row predates one.
  const blank = blankConfig();
  return {
    ...parsed.data,
    factors: { ...blank.factors, ...parsed.data.factors },
  };
}

/**
 * Doc 13 §4: "Do not ship a production ranking formula until management
 * approves weights, normalization, caps and attribution."
 *
 * This is the gate that enforces it. A config that fails these checks can be
 * saved and reviewed, but never activated and never used to produce a score.
 */
export function readyForActivation(config: ScoringConfig): string[] {
  const problems: string[] = [];

  const enabled = FACTOR_KEYS.filter((k) => config.factors[k]?.enabled);
  if (enabled.length === 0) {
    problems.push("No factor is enabled — the score would always be zero.");
  }

  for (const key of enabled) {
    const factor = config.factors[key];
    if (factor.weight === null) {
      problems.push(`"${key}" is enabled but has no approved weight.`);
    } else if (factor.weight === 0) {
      problems.push(`"${key}" is enabled with a weight of zero — disable it instead.`);
    }
    if (factor.normalisation === "CAPPED" && (factor.cap === null || factor.cap <= 0)) {
      problems.push(`"${key}" uses a cap but no cap value is set.`);
    }
    if (
      factor.normalisation === "PER_TARGET" &&
      (factor.target === null || factor.target <= 0)
    ) {
      problems.push(`"${key}" is measured against a target but no target is set.`);
    }
  }

  // Doc 13 §4 explicitly rejects a plain sum of raw counts as a ranking basis.
  const allRaw =
    enabled.length > 0 && enabled.every((k) => config.factors[k].normalisation === "RAW");
  if (allRaw) {
    problems.push(
      "Every enabled factor is a raw count. Doc 13 §4 warns this favours larger workloads — choose a normalisation basis before activating.",
    );
  }

  if (!config.approvalNote?.trim()) {
    problems.push(
      "Record who approved this configuration and what it is based on before activating.",
    );
  }

  return problems;
}
