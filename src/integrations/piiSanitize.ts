/**
 * PII field stripping for LIS document.* payloads.
 *
 * Drops sensitive fields from the structured extraction before document routes
 * are published. In-process — no subprocess, no external binary.
 *
 * Scope: this removes whole fields by name. It does NOT redact secrets embedded
 * in free text, so `rawText` is passed through untouched. Content-level
 * redaction belongs in diri-agent-guardrails; until that is wired in, callers
 * must not treat `rawText` as sanitized.
 */
import { config } from '../config/environment';

/** Field names dropped from structured output, matched case-insensitively. */
export function sensitiveFieldNames(): Set<string> {
  return new Set(
    config.pii.dropFields
      .split(',')
      .map((f) => f.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * Recursively remove sensitive fields from an object or array. Returns a new
 * value; the input is not mutated. Non-container values are returned as-is.
 */
export function dropSensitiveFields(value: unknown, fields = sensitiveFieldNames()): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => dropSensitiveFields(item, fields));
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (fields.has(key.toLowerCase())) continue;
    out[key] = dropSensitiveFields(val, fields);
  }
  return out;
}

/**
 * Strip sensitive fields from document route payloads before publish.
 *
 * `rawText` is returned unchanged — see the scope note above.
 */
export function sanitizeDocumentRoutePayloads(input: {
  rawText: string;
  structuredOutput: unknown;
}): { rawText: string; structuredOutput: unknown } {
  return {
    rawText: input.rawText,
    structuredOutput:
      input.structuredOutput === undefined || input.structuredOutput === null
        ? input.structuredOutput
        : dropSensitiveFields(input.structuredOutput),
  };
}
