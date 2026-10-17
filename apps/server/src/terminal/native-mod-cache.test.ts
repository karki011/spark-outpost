import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FACT_AT,
  fromEngine,
  startSparkMod,
  type SparkModHarness,
} from '../../test/spark-mod-engine.ts';
import { readModTelemetry } from './mod-telemetry.ts';

let mod: SparkModHarness;

afterEach(async () => {
  await mod.cleanup();
});

const recordedResume = JSON.parse(
  readFileSync(
    new URL('../../test/fixtures/prompt-cache/session-start-resume.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;

async function sessionStarts(payload: Record<string, unknown>) {
  await mod.hook('classic.SessionStart')(mod.engine, payload, fromEngine());
  mod.inbox({ messages: [], notices: [], status: null });
  mod.answer(204);
  await mod.tick();
}

describe('the Spark mod’s prompt cache facts', () => {
  it('forwards Claude Code’s resume figures from a recorded SessionStart', async () => {
    mod = await startSparkMod();
    await sessionStarts(recordedResume);
    const items = mod.sentItems(1).items;
    expect(items).toEqual([
      {
        kind: 'cache_resume',
        at: FACT_AT,
        secondsSince: 1245,
        contextTokens: 38_693,
        likelyExpired: false,
        estimatedWriteUsd: 0.0077,
      },
    ]);
    expect(readModTelemetry({ items })).toEqual(items);
    expect(JSON.stringify(items)).not.toMatch(/fixture|redacted/);
  });

  it('sends nothing for a fresh start', async () => {
    mod = await startSparkMod();
    await sessionStarts({ ...recordedResume, source: 'startup' });
    expect(mod.requests).toHaveLength(1);
  });

  it('drops figures Claude Code did not give and keeps the rest', async () => {
    mod = await startSparkMod();
    await sessionStarts({
      source: 'fork',
      context_tokens: 500,
      seconds_since_last_response: 'later',
      estimated_cache_write_usd: -1,
    });
    expect(mod.sentItems(1).items).toEqual([
      {
        kind: 'cache_resume',
        at: FACT_AT,
        secondsSince: null,
        contextTokens: 500,
        likelyExpired: null,
        estimatedWriteUsd: null,
      },
    ]);
  });
});
