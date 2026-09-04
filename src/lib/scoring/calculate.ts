import { FACTORS, FACTOR_KEYS, type FactorKey, type FactorValues } from "@/lib/scoring/factors";
import { readyForActivation, type ScoringConfig } from "@/lib/scoring/config";

/**
 * Score calculation (doc 13 §4, §10).
 *
 * Every result carries its full derivation — raw value, normalised value,
 * weight, direction and contribution — so §10 is satisfied: a manager can
 * answer "which period, which configuration, what raw values, what weight,
 * what did each factor contribute".
 */

export type FactorContribution = {
  key: FactorKey;
  label: string;
  direction: "POSITIVE" | "NEGATIVE";
  raw: number;
  normalisation: string;
  /** The value after normalisation, before weighting. */
  normalised: number;
  weight: number;
  /** Signed: negative factors subtract. */
  contribution: number;
  /** Set when the raw measure depends on an undecided business rule. */
  caveat?: string;
};

export type ScoreResult =
  | {
      ok: true;
      score: number;
      contributions: FactorContribution[];
      /** True when activity fell below the configured minimum sample size. */
      belowSampleSize: boolean;
      clampedAtZero: boolean;
      clampedAtCeiling: boolean;
    }
  | { ok: false; reason: string; problems: string[] };

export type ScoreContext = {
  /** Denominator for PER_ASSIGNED. */
  assignedCustomers: number;
};

function normalise(
  raw: number,
  config: { normalisation: string; cap: number | null; target: number | null },
  context: ScoreContext,
): number {
  switch (config.normalisation) {
    case "PER_ASSIGNED":
      // No assigned customers means no opportunity, not a zero-divide.
      return context.assignedCustomers > 0 ? raw / context.assignedCustomers : 0;
    case "PER_TARGET":
      return config.target && config.target > 0 ? raw / config.target : 0;
    case "CAPPED":
      return config.cap !== null ? Math.min(raw, config.cap) : raw;
    default:
      return raw;
  }
}

/**
 * Calculate one score.
 *
 * Refuses outright if the configuration is not approvable. A score is never
 * produced from an incomplete configuration, so no unweighted number can leak
 * into a ranking (doc 13 §4).
 */
export function calculateScore(
  config: ScoringConfig,
  values: FactorValues,
  context: ScoreContext,
): ScoreResult {
  const problems = readyForActivation(config);
  if (problems.length > 0) {
    return {
      ok: false,
      reason:
        "This scoring configuration is not approved for use, so no score is produced.",
      problems,
    };
  }

  const contributions: FactorContribution[] = [];
  let total = 0;
  let measuredActivity = 0;

  for (const key of FACTOR_KEYS) {
    const factorConfig = config.factors[key];
    if (!factorConfig?.enabled || factorConfig.weight === null) continue;

    const spec = FACTORS[key];
    const raw = values[key] ?? 0;
    const normalised = normalise(raw, factorConfig, context);
    const signed = spec.direction === "NEGATIVE" ? -1 : 1;
    const contribution = normalised * factorConfig.weight * signed;

    total += contribution;
    if (spec.direction === "POSITIVE") measuredActivity += raw;

    contributions.push({
      key,
      label: spec.label,
      direction: spec.direction,
      raw,
      normalisation: factorConfig.normalisation,
      normalised,
      weight: factorConfig.weight,
      contribution,
      caveat: spec.pendingDecision,
    });
  }

  let clampedAtZero = false;
  if (!config.allowNegativeTotal && total < 0) {
    total = 0;
    clampedAtZero = true;
  }

  let clampedAtCeiling = false;
  if (config.scoreCeiling !== null && total > config.scoreCeiling) {
    total = config.scoreCeiling;
    clampedAtCeiling = true;
  }

  return {
    ok: true,
    // Four decimals matches the Decimal(10,4) column, so what is displayed is
    // what is stored.
    score: Math.round(total * 10000) / 10000,
    contributions,
    belowSampleSize: measuredActivity < config.minimumSampleSize,
    clampedAtZero,
    clampedAtCeiling,
  };
}

/**
 * Doc 13 §8 — ranking is allowed only when scores are comparable under the
 * same period and configuration, and enough activity exists to be meaningful.
 */
export function rankable(
  results: { staffId: string; result: ScoreResult }[],
): { staffId: string; score: number }[] | { blocked: string } {
  const usable = results.filter(
    (r): r is { staffId: string; result: Extract<ScoreResult, { ok: true }> } =>
      r.result.ok,
  );

  if (usable.length !== results.length) {
    return { blocked: "Some staff have no calculable score under this configuration." };
  }
  if (usable.some((r) => r.result.belowSampleSize)) {
    return {
      blocked:
        "Some staff fall below the configured minimum sample size, so a ranking would not be comparable.",
    };
  }

  return usable
    .map((r) => ({ staffId: r.staffId, score: r.result.score }))
    .sort((a, b) => b.score - a.score);
}
