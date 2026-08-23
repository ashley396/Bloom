/**
 * Closed-loop learning — Section 27 of the build directive: an insight
 * must be explicitly labeled as a fact, an observation, a correlation, a
 * recommendation, or an experiment result. This module only ever produces
 * 'observation'/'correlation'/'recommendation' — those are the only kinds
 * derivable from grouping real metric rows by sample size. 'fact' (a
 * directly-observed single data point, e.g. "this post got 40 likes") and
 * 'experiment_result' (a completed A/B test — see
 * marketing-ab-testing.js) come from elsewhere; this file never assigns
 * either, since neither is a statistical-grouping question.
 *
 * The classification is driven ENTIRELY by real sample size, never by how
 * large or interesting a pattern looks — a 3x average from 2 data points
 * stays an 'observation', not a 'correlation', let alone a
 * 'recommendation'. Raising these thresholds only ever makes the system
 * more conservative about what it calls settled, never less.
 */

export const INSIGHT_KINDS = Object.freeze(["observation", "correlation", "recommendation"]);

const MIN_SAMPLE_FOR_CORRELATION = 10;
const MIN_SAMPLE_FOR_RECOMMENDATION = 30;

/** Classifies a grouped comparison by real sample size alone. Returns
 * null for an empty group — there is no insight kind for zero evidence. */
export function classifyInsight({ sampleSize }) {
  const n = Number(sampleSize) || 0;
  if (n <= 0) return null;
  if (n < MIN_SAMPLE_FOR_CORRELATION) return "observation";
  if (n < MIN_SAMPLE_FOR_RECOMMENDATION) return "correlation";
  return "recommendation";
}

/** Groups real metric rows by a dimension (e.g. platform) and computes a
 * plain average value per group, each honestly labeled by its own real
 * sample size. Sorted highest-average-first so the caller can surface the
 * strongest real pattern first — sorting never changes the classification. */
export function groupMetricsByDimension(rows, dimensionKey, valueKey = "value") {
  const groups = new Map();
  for (const row of rows || []) {
    const key = row?.[dimensionKey];
    if (key == null) continue;
    const value = Number(row?.[valueKey]);
    if (!Number.isFinite(value)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(value);
  }
  return [...groups.entries()]
    .map(([key, values]) => {
      const sampleSize = values.length;
      const average = values.reduce((a, b) => a + b, 0) / sampleSize;
      return { key, sampleSize, average, kind: classifyInsight({ sampleSize }) };
    })
    .sort((a, b) => b.average - a.average);
}
