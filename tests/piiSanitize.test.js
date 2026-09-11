/**
 * Unit tests for PII sanitization on document route payloads:
 * field stripping on structured output, text redaction on free text.
 */
const assert = require('assert');

delete require.cache[require.resolve('../dist/config/environment')];

function noSecrets(text) {
  assert.ok(!/sk-live-/.test(text), `raw secret left in: ${text}`);
  assert.ok(!/@example\.com/.test(text), `raw email left in: ${text}`);
}

async function main() {
  let sanitize;
  try {
    sanitize = require('../dist/integrations/piiSanitize');
  } catch {
    console.log('SKIP: dist not built — run npm run build first for piiSanitize tests');
    process.exit(0);
  }

  // --- field stripping -----------------------------------------------------

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

  assert.strictEqual(s.intelligenceProfile, 'lease');
  assert.strictEqual(s.parties[0].name, 'Alice');
  assert.strictEqual(s.parties[0].role, 'tenant');
  assert.strictEqual(s.nested.financials.total, 1200);
  console.log('piiSanitize: pass (preserves non-sensitive fields)');

  const mixed = sanitize.dropSensitiveFields({ Email: 'a@b.c', APIKey: 'sk-1', keep: 1 });
  assert.strictEqual(mixed.Email, undefined);
  assert.strictEqual(mixed.APIKey, undefined);
  assert.strictEqual(mixed.keep, 1);
  console.log('piiSanitize: pass (case-insensitive field match)');

  assert.strictEqual(input.structuredOutput.email, 'alice@example.com');
  console.log('piiSanitize: pass (input not mutated)');

  // --- text redaction ------------------------------------------------------

  const r = (t) => sanitize.redactText(t).text;

  assert.strictEqual(r('Contact me at alice@example.com'), 'Contact me at [REDACTED:email]');
  assert.strictEqual(r('SSN 123-45-6789 on file'), 'SSN [REDACTED:ssn] on file');
  assert.strictEqual(r('call 415-555-0100 today'), 'call [REDACTED:phone] today');
  console.log('piiSanitize: pass (email, ssn, phone in free text)');

  // Bare provider tokens — the case field stripping can never reach.
  noSecrets(r('Deploy key sk-live-abcdefghijklmnop1234'));
  noSecrets(r('aws AKIAIOSFODNN7EXAMPLE rotated'));
  assert.ok(r('token ghp_' + 'a'.repeat(36)).includes('[REDACTED:'));
  console.log('piiSanitize: pass (bare provider tokens)');

  // Keyed credentials keep the key and redact only the value. This is the
  // "my password is hunter2" case — the word `is` must survive.
  const pw = r('my password is hunter2 ok');
  assert.ok(pw.includes('password is [REDACTED:credential]'), pw);
  assert.ok(!pw.includes('hunter2'), pw);
  assert.strictEqual(r('api_key=abc123XYZ'), 'api_key=[REDACTED:credential]');
  console.log('piiSanitize: pass (keyed credential keeps key, redacts value)');

  // Luhn guard: a 16-digit order number is not a credit card.
  assert.strictEqual(r('order 1234 5678 9012 3456 shipped'), 'order 1234 5678 9012 3456 shipped');
  assert.ok(r('card 4111 1111 1111 1111 charged').includes('[REDACTED:credit_card]'));
  console.log('piiSanitize: pass (Luhn guard on credit cards)');

  // Ordinary text is left alone.
  const clean = 'The lease term is 24 months at 1200 per month.';
  assert.strictEqual(r(clean), clean);
  console.log('piiSanitize: pass (clean text untouched)');

  // --- end to end ----------------------------------------------------------

  const e2e = sanitize.sanitizeDocumentRoutePayloads({
    rawText: 'Deploy key sk-live-abcdefghijklmnop1234 owned by alice@example.com',
    structuredOutput: { note: 'reach alice@example.com', email: 'alice@example.com' },
  });
  noSecrets(e2e.rawText);
  assert.strictEqual(e2e.structuredOutput.email, undefined);
  noSecrets(e2e.structuredOutput.note);
  assert.ok(e2e.redactions >= 2, `expected redactions, got ${e2e.redactions}`);
  console.log('piiSanitize: pass (rawText and structured strings both redacted)');

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
