import type { AbstractPipelineId } from './cyrexClient';

const PIPELINE_A_PROFILES = new Set(
  ['pipeline_a', 'cyrex_a', 'primary', 'alpha', 'v1', 'structured_a'].map((s) => s.toLowerCase())
);

const PIPELINE_B_PROFILES = new Set(
  ['pipeline_b', 'cyrex_b', 'secondary', 'beta', 'v2', 'structured_b'].map((s) => s.toLowerCase())
);

/**
 * Maps `intelligenceProfile` + optional `profileHints` to Cyrex HTTP path group (A or B).
 * Configure actual URLs with CYREX_PIPELINE_A_PATH / CYREX_PIPELINE_B_PATH.
 */
export function resolveAbstractPipeline(
  intelligenceProfile: string,
  profileHints?: Record<string, unknown> | null,
  documentKind?: string | null
): AbstractPipelineId {
  const forced = profileHints?.pipeline;
  if (forced === 'A' || forced === 'B') return forced;

  const p = intelligenceProfile.trim().toLowerCase();
  if (PIPELINE_A_PROFILES.has(p)) return 'A';
  if (PIPELINE_B_PROFILES.has(p)) return 'B';

  const k = (documentKind || '').toLowerCase();
  if (k.includes('alpha') || k.includes('primary') || k.endsWith('_a')) return 'A';

  return 'B';
}
