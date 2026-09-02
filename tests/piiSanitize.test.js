/**
 * Unit tests for PII field stripping on document route payloads.
 */
const assert = require('assert');

delete require.cache[require.resolve('../dist/config/environment')];

async function main() {
  let sanitize;
  try {
    sanitize = require('../dist/integrations/piiSanitize');
  } catch {
    console.log('SKIP: dist not built — run npm run build first for piiSanitize tests');
    process.exit(0);
  }

  // Sensitive fields are dropped from structured output at any depth.
  const input = {
    rawText: 'Contact me at alice@example.com',
    structuredOutput: {
      intelligenceProfile: 'lease',
      email: 'alice@example.com',
      parties: [{ name: 'Alice', phone: '555-0100', role: 'tenant' }],
      nested: { financials: { total: 1200, apiKey: 'sk-live-abc' } },
    },
  };
  const out = sanitize.sanitizeDocumentRoutePayloads(input);
  const s = out.structuredOutput;

  assert.strictEqual(s.email, undefined);
  assert.strictEqual(s.parties[0].phone, undefined);
  assert.strictEqual(s.nested.financials.apiKey, undefined);
  console.log('piiSanitize: pass (drops sensitive fields at any depth)');

  // Non-sensitive fields survive unchanged.
  assert.strictEqual(s.intelligenceProfile, 'lease');
  assert.strictEqual(s.parties[0].name, 'Alice');
  assert.strictEqual(s.parties[0].role, 'tenant');
  assert.strictEqual(s.nested.financials.total, 1200);
  console.log('piiSanitize: pass (preserves non-sensitive fields)');

  // Field matching is case-insensitive.
  const mixed = sanitize.dropSensitiveFields({ Email: 'a@b.c', APIKey: 'sk-1', keep: 1 });
  assert.strictEqual(mixed.Email, undefined);
  assert.strictEqual(mixed.APIKey, undefined);
  assert.strictEqual(mixed.keep, 1);
  console.log('piiSanitize: pass (case-insensitive field match)');

  // Input is not mutated.
  assert.strictEqual(input.structuredOutput.email, 'alice@example.com');
  console.log('piiSanitize: pass (input not mutated)');

  // rawText is passed through untouched — field stripping cannot redact free
  // text. Guards against anyone assuming rawText is sanitized here.
  assert.strictEqual(out.rawText, input.rawText);
  console.log('piiSanitize: pass (rawText passed through unchanged)');

  // Null/undefined structured output is preserved rather than coerced.
  assert.strictEqual(
    sanitize.sanitizeDocumentRoutePayloads({ rawText: 'x', structuredOutput: null })
      .structuredOutput,
    null
  );
  assert.strictEqual(
    sanitize.sanitizeDocumentRoutePayloads({ rawText: 'x', structuredOutput: undefined })
      .structuredOutput,
    undefined
  );
  console.log('piiSanitize: pass (null/undefined structured output preserved)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
