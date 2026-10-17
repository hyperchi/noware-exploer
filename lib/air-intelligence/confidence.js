/* Confidence scoring shared by source inference and contractor insights.
 *
 * Scores are 0..1 and are shown to people only as low / medium / high, never
 * as false precision. Evidence items carry the score so every conclusion can
 * be inspected in the developer view.
 */

export function confidenceLevel(score) {
  if (score >= 0.7) return 'high';
  if (score >= 0.45) return 'medium';
  return 'low';
}

export const CONFIDENCE_LABEL = Object.freeze({ high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' });

/**
 * Combine weighted evidence into a score. Supporting items add, opposing items
 * subtract, and the total is squashed into 0..1 with `prior` as the midpoint
 * pull. Deterministic and easy to read in a debug dump.
 */
export function scoreEvidence(evidence, { prior = 0.2, cap = 1 } = {}) {
  let total = 0;
  for (const e of evidence) total += (e.supports ? 1 : -1) * e.weight;
  const score = prior + total;
  return Math.max(0, Math.min(cap, score));
}

export const evidence = (kind, text, supports, weight, channel) => ({ kind, text, supports, weight, channel });

export function round2(x) {
  return Math.round(x * 100) / 100;
}
