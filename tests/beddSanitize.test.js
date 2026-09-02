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

  // getBeddHealth() reflects the disabled binary as 'disabled', not 'ok' or
  // 'degraded' -- those only apply once Bedd is actually enabled.
  const health = sanitize.getBeddHealth();
  assert.strictEqual(health.status, 'disabled');
  assert.strictEqual(health.enabled, false);

  console.log('beddSanitize: pass (health reports disabled)');

  // Concurrent acquire after a release must not grant two slots for one
  // vacancy. The waiter is woken as a microtask; a same-turn acquire must
  // queue instead of also incrementing.
  const { acquireEvalSlot, MAX_CONCURRENT_EVALS } = sanitize;
  const held = [];
  for (let i = 0; i < MAX_CONCURRENT_EVALS; i += 1) {
    held.push(await acquireEvalSlot());
  }

  let waiterGot = false;
  let sneakyGot = false;
  const waiterP = acquireEvalSlot().then((release) => {
    waiterGot = true;
    return release;
  });
  held[0]();
  const sneakyP = acquireEvalSlot().then((release) => {
    sneakyGot = true;
    return release;
  });
  await Promise.resolve();
  await Promise.resolve();

  assert.strictEqual(waiterGot, true, 'queued waiter should receive the released slot');
  assert.strictEqual(
    sneakyGot,
    false,
    'a same-turn acquire must not take a second slot while a waiter holds the vacancy'
  );

  const waiterRelease = await waiterP;
  waiterRelease();
  const sneakyRelease = await sneakyP;
  sneakyRelease();
  for (let i = 1; i < held.length; i += 1) {
    held[i]();
  }

  console.log('beddSanitize: pass (eval slot cap is not exceeded under concurrent acquire)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
