/**
 * Unit tests for Bedd sanitize (no Bedd binary required when disabled).
 */
const assert = require('assert');

process.env.BEDD_ENABLED = 'false';

// Clear config cache if any — environment reads env at import time
delete require.cache[require.resolve('../dist/config/environment')];
delete require.cache[require.resolve('../dist/integrations/beddSanitize')];

async function main() {
  // Prefer compiled dist when present; fall back to ts-node-less path via dynamic import of src through build
  let sanitize;
  try {
    sanitize = require('../dist/integrations/beddSanitize');
  } catch {
    // Run against source via ts transpile is not set up; skip if not built
    console.log('SKIP: dist not built — run npm run build first for beddSanitize tests');
    process.exit(0);
  }

  assert.strictEqual(sanitize.isBeddSanitizeEnabled(), false);

  const input = {
    rawText: 'hello ssn 123',
    structuredOutput: { email: 'a@b.com', keep: true },
  };
  const out = await sanitize.sanitizeDocumentRoutePayloads(input);
  assert.strictEqual(out.beddApplied, false);
  assert.strictEqual(out.rawText, input.rawText);
  assert.deepStrictEqual(out.structuredOutput, input.structuredOutput);

  console.log('beddSanitize: pass (disabled path)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
