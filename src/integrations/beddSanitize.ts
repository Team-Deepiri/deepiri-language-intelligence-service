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
  if (flag === true) return binaryExists(config.bedd.bin);
  if (flag === false) return false;
  // auto: use Bedd when the binary is present (Docker image embeds it)
  return binaryExists(config.bedd.bin);
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

  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['eval', skill, input], {
      env: {
        ...process.env,
        BEDD_SKILLS_DIR: config.bedd.skillsDir || process.env.BEDD_SKILLS_DIR,
        BEDD_DROP_FIELDS: config.bedd.dropFields || process.env.BEDD_DROP_FIELDS,
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

    return { rawText, structuredOutput, beddApplied: true };
  } catch (err: any) {
    logger.warn('[Language Intelligence] Bedd sanitize failed; publishing unsanitized', {
      error: err?.message || String(err),
      skill: config.bedd.skill,
    });
    return {
      rawText: input.rawText,
      structuredOutput: input.structuredOutput,
      beddApplied: false,
    };
  }
}
