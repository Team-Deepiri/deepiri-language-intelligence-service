#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

const DEFAULT_TEST_TARGETS = ['tests/documentRoutePublicationService.test.js'];

function shouldIgnoreArg(arg) {
  return arg === '--' || arg === '--passWithNoTests' || arg.startsWith('--passWithNoTests=');
}

function looksLikeTestTarget(arg) {
  return (
    !arg.startsWith('-') &&
    (
      arg === 'test' ||
      arg === 'tests' ||
      arg.includes('/') ||
      /\.(?:c|m)?js$/.test(arg)
    )
  );
}

const forwardedArgs = process.argv.slice(2).filter((arg) => !shouldIgnoreArg(arg));
const hasExplicitTestTarget = forwardedArgs.some(looksLikeTestTarget);
const nodeTestArgs = hasExplicitTestTarget
  ? forwardedArgs
  : [...forwardedArgs, ...DEFAULT_TEST_TARGETS];

const result = spawnSync(process.execPath, ['--test', ...nodeTestArgs], {
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
