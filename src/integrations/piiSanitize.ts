/**
 * PII sanitization for LIS document.* payloads.
 *
 * Two passes, both in-process — no subprocess, no external binary:
 *   1. Field stripping — drops sensitive fields from the structured extraction
 *      by name (`email`, `ssn`, `password`, ...).
 *   2. Text redaction — rewrites secrets found inside free text, which field
 *      stripping cannot reach because the secret is a substring, not a key.
 *
 * The patterns mirror diri-agent-guardrails' PIIChecker, plus the bare provider
 * tokens it does not cover (sk-*, AKIA*, gh*_, JWTs). Guardrails is a Python
 * library, so it cannot be imported here; if these two ever diverge, guardrails
 * is the reference for the shared rules.
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

/** Keys that introduce a credential value in prose or config-style text. */
const CREDENTIAL_KEY =
  '(?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|' +
  'token|bearer|client[_-]?secret|private[_-]?key|credentials?)';

/**
 * Luhn check, used to keep 16-digit order numbers and internal IDs from being
 * redacted as credit cards.
 */
function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

interface TextRule {
  label: string;
  pattern: RegExp;
  /**
   * When set, the match is kept and only this capture group is replaced. Used
   * for `password: hunter2`, where the key is context worth preserving and only
   * the value is secret.
   */
  valueGroup?: number;
  /** Optional guard; return false to leave the match alone. */
  accept?: (match: string) => boolean;
}

/**
 * Ordered — keyed credentials run first so `api_key: alice@example.com` is
 * redacted as a credential rather than partially matched as an email.
 */
const TEXT_RULES: TextRule[] = [
  {
    label: 'credential',
    pattern: new RegExp(`\\b${CREDENTIAL_KEY}\\b\\s*(?:[:=]|\\bis\\b)\\s*(\\S+)`, 'gi'),
    valueGroup: 1,
  },
  { label: 'token', pattern: /\bsk-(?:live|test|proj)?-?[A-Za-z0-9]{16,}\b/g },
  { label: 'token', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: 'token', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  {
    label: 'token',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  { label: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  {
    label: 'credit_card',
    pattern: /\b(?:\d{4}[- ]?){3}\d{4}\b/g,
    accept: (m) => passesLuhn(m.replace(/[- ]/g, '')),
  },
  // A separator is required: a bare 10-digit run is more often an identifier
  // or an amount than a phone number.
  { label: 'phone', pattern: /\b(?:\+?1[-. ])?\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/g },
  { label: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
];

/**
 * Replace secrets in free text with `[REDACTED:<label>]`.
 *
 * Returns the rewritten text and how many replacements were made, so callers
 * can log or assert on coverage without re-scanning.
 */
export function redactText(text: string): { text: string; redactions: number } {
  if (!text) return { text, redactions: 0 };

  let out = text;
  let redactions = 0;

  for (const rule of TEXT_RULES) {
    // Fresh regex per pass: the literals are /g and carry lastIndex.
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    out = out.replace(pattern, (match, ...groups) => {
      if (rule.accept && !rule.accept(match)) return match;
      redactions += 1;
      const placeholder = `[REDACTED:${rule.label}]`;
      if (rule.valueGroup === undefined) return placeholder;

      const value = groups[rule.valueGroup - 1] as string | undefined;
      if (!value) return match;
      // Keep the key and separator, replace only the value.
      return match.slice(0, match.length - value.length) + placeholder;
    });
  }

  return { text: out, redactions };
}

/** Recursively redact secrets inside every string of a structured value. */
function redactStringsDeep(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value).text;
  if (Array.isArray(value)) return value.map(redactStringsDeep);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = redactStringsDeep(val);
  }
  return out;
}

/**
 * Sanitize document route payloads before publish: drop sensitive fields from
 * the structured extraction, then redact secrets from the remaining free text.
 */
export function sanitizeDocumentRoutePayloads(input: {
  rawText: string;
  structuredOutput: unknown;
}): { rawText: string; structuredOutput: unknown; redactions: number } {
  const { text: rawText, redactions } = redactText(input.rawText);

  const structuredOutput =
    input.structuredOutput === undefined || input.structuredOutput === null
      ? input.structuredOutput
      : redactStringsDeep(dropSensitiveFields(input.structuredOutput));

  return { rawText, structuredOutput, redactions };
}
