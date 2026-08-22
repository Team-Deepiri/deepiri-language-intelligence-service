/**
 * Optional Bedd skill pass for LIS document.* payloads.
 *
 * Bedd stays out of the platform data plane — LIS is the only service that
 * shells out to `bedd eval` before Sugar Glider publish of document routes.
 * Fail-open: if Bedd is disabled, missing, or errors, the original payload
 * is returned so ingestion still completes.
 */
import { spawn } from 'child_process';
import { accessSync, constants } from 'fs';
import { config } from '../config/environment';
import { logger } from '../utils/logger';

const EVAL_TIMEOUT_MS = 15_000;
// Bounds concurrent `bedd eval` child processes so a burst of document
// ingestion can't exhaust the process table. Each call already does two
// spawns (text + structured), so this caps at MAX_CONCURRENT_EVALS/2
// in-flight sanitize() calls.
export const MAX_CONCURRENT_EVALS = 8;
// Consecutive failures at which /health reports Bedd as degraded. Fail-open
// means a broken Bedd is otherwise invisible -- PII keeps flowing through
// unredacted with nothing louder than a warn log per call.
const DEGRADED_AFTER_CONSECUTIVE_FAILURES = 5;

interface BeddHealthState {
  enabled: boolean;
  totalCalls: number;
  totalFailures: number;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
}

const health: BeddHealthState = {
  enabled: false,
  totalCalls: 0,
  totalFailures: 0,
  consecutiveFailures: 0,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastError: null,
};

function recordSuccess(): void {
  health.totalCalls += 1;
  health.consecutiveFailures = 0;
  health.lastSuccessAt = new Date().toISOString();
}

function recordFailure(error: string): void {
  health.totalCalls += 1;
  health.totalFailures += 1;
  health.consecutiveFailures += 1;
  health.lastFailureAt = new Date().toISOString();
  health.lastError = error;
}

/**
 * Bedd health snapshot for /health. `status` is 'degraded' once
 * consecutiveFailures crosses DEGRADED_AFTER_CONSECUTIVE_FAILURES, since
 * fail-open otherwise hides a broken redaction path behind 200s.
 */
export function getBeddHealth(): BeddHealthState & {
  status: 'disabled' | 'ok' | 'degraded';
} {
  if (!health.enabled) {
    return { ...health, status: 'disabled' };
  }
  const status =
    health.consecutiveFailures >= DEGRADED_AFTER_CONSECUTIVE_FAILURES
      ? 'degraded'
      : 'ok';
  return { ...health, status };
}

let inFlightEvals = 0;
const evalWaitQueue: Array<() => void> = [];

export async function acquireEvalSlot(): Promise<() => void> {
  if (inFlightEvals < MAX_CONCURRENT_EVALS) {
    inFlightEvals += 1;
    return () => releaseEvalSlot();
  }
  await new Promise<void>((resolve) => evalWaitQueue.push(resolve));
  // Slot was transferred by the releaser; do not increment again.
  return () => releaseEvalSlot();
}

function releaseEvalSlot(): void {
  const next = evalWaitQueue.shift();
  if (next) {
    next();
    return;
  }
  inFlightEvals -= 1;
}

function binaryExists(bin: string): boolean {
  try {
    accessSync(bin, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function isBeddSanitizeEnabled(): boolean {
  const flag = config.bedd.enabled;
  const enabled = flag === false ? false : binaryExists(config.bedd.bin);
  health.enabled = enabled;
  return enabled;
}

function unwrapStrikeData(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== 'object') {
    return parsed;
  }
  const root = parsed as Record<string, unknown>;
  const data = root.data;
  if (!data || typeof data !== 'object') {
    return parsed;
  }
  const record = data as Record<string, unknown>;
  if (record.redacted !== undefined) {
    return record.redacted;
  }
  if (record.ok === true && record.output !== undefined) {
    return record.output;
  }
  // drop_fields / passthrough: transformed object is the data body
  const metaKeys = new Set([
    'skill',
    'stream',
    'entry_id',
    'event_type',
    'ok',
    'input',
    'error',
  ]);
  const keys = Object.keys(record);
  if (keys.some((k) => !metaKeys.has(k))) {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) {
      if (!metaKeys.has(k)) cleaned[k] = v;
    }
    return cleaned;
  }
  return data;
}

export async function beddEvalJson(
  payload: unknown,
  skill = config.bedd.skill
): Promise<unknown> {
  const bin = config.bedd.bin;
  const input = JSON.stringify(payload);

  const release = await acquireEvalSlot();
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(bin, ['eval', skill, input], {
        // Minimal, explicit env for a binary that handles PII payloads --
        // no reason to hand it the full process env (secrets, other
        // services' credentials) just to run a redaction pass.
        env: {
          PATH: process.env.PATH || '',
          BEDD_SKILLS_DIR: config.bedd.skillsDir || process.env.BEDD_SKILLS_DIR || '',
          BEDD_DROP_FIELDS: config.bedd.dropFields || process.env.BEDD_DROP_FIELDS || '',
          BEDD_LEAN: process.env.BEDD_LEAN || '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`bedd eval timed out after ${EVAL_TIMEOUT_MS}ms`));
      }, EVAL_TIMEOUT_MS);

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(
            new Error(
              `bedd eval exited ${code}: ${(stderr || stdout).trim().slice(0, 500)}`
            )
          );
          return;
        }
        try {
          const line = stdout.trim().split('\n').filter(Boolean).pop() || '{}';
          resolve(unwrapStrikeData(JSON.parse(line)));
        } catch (err: any) {
          reject(
            new Error(`bedd eval returned non-JSON: ${err?.message || String(err)}`)
          );
        }
      });
    });
  } finally {
    release();
  }
}

/**
 * Sanitize document route text + structured extraction before document.* publish.
 * Returns originals when Bedd is off or fails (fail-open).
 */
export async function sanitizeDocumentRoutePayloads(input: {
  rawText: string;
  structuredOutput: unknown;
}): Promise<{ rawText: string; structuredOutput: unknown; beddApplied: boolean }> {
  if (!isBeddSanitizeEnabled()) {
    return {
      rawText: input.rawText,
      structuredOutput: input.structuredOutput,
      beddApplied: false,
    };
  }

  try {
    const textWrapped = { content: input.rawText };
    const sanitizedText = (await beddEvalJson(textWrapped)) as Record<string, unknown>;
    const rawText =
      typeof sanitizedText?.content === 'string'
        ? sanitizedText.content
        : input.rawText;

    let structuredOutput = input.structuredOutput;
    if (structuredOutput !== undefined && structuredOutput !== null) {
      structuredOutput = await beddEvalJson(structuredOutput);
    }

    recordSuccess();
    return { rawText, structuredOutput, beddApplied: true };
  } catch (err: any) {
    const message = err?.message || String(err);
    recordFailure(message);
    const logFn = health.consecutiveFailures >= DEGRADED_AFTER_CONSECUTIVE_FAILURES
      ? logger.error.bind(logger)
      : logger.warn.bind(logger);
    logFn('[Language Intelligence] Bedd sanitize failed; publishing unsanitized', {
      error: message,
      skill: config.bedd.skill,
      consecutiveFailures: health.consecutiveFailures,
    });
    return {
      rawText: input.rawText,
      structuredOutput: input.structuredOutput,
      beddApplied: false,
    };
  }
}
