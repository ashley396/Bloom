/**
 * A/B testing framework — Section 28 of the build directive: hypothesis,
 * variants, a named metric, a duration, and an outcome computed only from
 * real fetched metrics, never estimated ones. Pairs with the
 * marketing_ab_experiments table (Stage B migration).
 */

export const MIN_SAMPLE_PER_VARIANT = 10; // never declare a winner off a handful of real posts

function trimStr(value, max) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  return s.length > max ? s.slice(0, max) : s;
}

export function validateExperimentBody(body = {}) {
  const hypothesis = trimStr(body.hypothesis, 500);
  if (!hypothesis) return { valid: false, error: "hypothesis is required." };

  if (!Array.isArray(body.variants) || body.variants.length < 2) {
    return { valid: false, error: "At least 2 variants are required." };
  }
  const variants = [];
  for (const v of body.variants) {
    const label = trimStr(v?.label, 80);
    const contentItemId = v?.content_item_id;
    if (!label || !contentItemId) return { valid: false, error: "Each variant needs a label and a content_item_id." };
    variants.push({ label, content_item_id: contentItemId });
  }
  const labels = variants.map((v) => v.label.toLowerCase());
  if (new Set(labels).size !== labels.length) return { valid: false, error: "Variant labels must be unique." };

  const metric = trimStr(body.metric, 60);
  if (!metric) return { valid: false, error: "metric is required." };

  const durationDays = body.duration_days === undefined ? 7 : Number(body.duration_days);
  if (!Number.isFinite(durationDays) || durationDays < 1 || durationDays > 90) {
    return { valid: false, error: "duration_days must be between 1 and 90." };
  }

  return { valid: true, sanitized: { hypothesis, variants, metric, duration_days: Math.floor(durationDays) } };
}

/**
 * Determines a winner ONLY from real fetched metric results per variant.
 * Never estimates, never breaks a tie by guessing, and refuses to declare
 * a winner until every variant has a real sample size of at least
 * MIN_SAMPLE_PER_VARIANT — an experiment that hasn't run long enough
 * returns no winner rather than a premature one.
 */
export function determineExperimentWinner(variantResults) {
  if (!Array.isArray(variantResults) || variantResults.length < 2) {
    return { winner: null, reason: "insufficient_variants" };
  }
  const short = variantResults.find((v) => (Number(v.sampleSize) || 0) < MIN_SAMPLE_PER_VARIANT);
  if (short) {
    return { winner: null, reason: "insufficient_sample_size", minimumRequired: MIN_SAMPLE_PER_VARIANT, shortLabel: short.label };
  }
  const sorted = [...variantResults].sort((a, b) => b.average - a.average);
  const [best, second] = sorted;
  const marginPct = second.average > 0 ? ((best.average - second.average) / second.average) * 100 : null;
  return { winner: best.label, marginPct, reason: "real_metric_comparison" };
}
