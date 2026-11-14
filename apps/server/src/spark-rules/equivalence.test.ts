import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decide, NO_RUN_RULES, type Decision } from '../approvals/decide.ts';
import { CORPUS_POSTURES, corpusCases } from '../approvals/spark-rules-corpus.ts';
import { RECOMMENDED_RULES, recommendedRulesText, userRules } from './recommended.ts';
import type { SparkRuleSet } from './resolve.ts';
import { changedRulesText } from './rules-file.ts';
import { loadSparkRules, type SparkRulesFiles } from './rules-store.ts';

interface Fixture {
  reasons: string[];
  verdicts: Record<string, Record<string, unknown>>;
}

const FIXTURE = JSON.parse(
  readFileSync(new URL('../approvals/fixtures/spark-rules-verdicts.json', import.meta.url), 'utf8'),
) as Fixture;

function before(key: string): Record<string, unknown> {
  const recorded = FIXTURE.verdicts[key];
  if (!recorded) throw new Error(`No recorded verdict for ${key}`);
  const { reason } = recorded;
  return typeof reason === 'number' ? { ...recorded, reason: FIXTURE.reasons[reason] } : recorded;
}

function withoutMarker(decision: Decision): Decision {
  if (decision.verdict !== 'ask' || !decision.outsideWrite) return decision;
  const { verdict, reason, ...rest } = decision;
  delete rest.outsideWrite;
  return { verdict, reason, ...rest };
}

function verdicts(rules: SparkRuleSet): Record<string, Decision> {
  const found: Record<string, Decision> = {};
  for (const item of corpusCases()) {
    for (const posture of CORPUS_POSTURES) {
      const options = { ...item.options, browserData: null, sparkRules: { rules, once: [] } };
      found[`${item.name} @${posture}`] = decide(posture, item.request, NO_RUN_RULES, [], options);
    }
  }
  return found;
}

let dir: string;
let files: SparkRulesFiles;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spark-rules-equivalence-'));
  files = { user: join(dir, 'settings.json'), managed: join(dir, 'managed-settings.json') };
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('the recommended rules', () => {
  it('read back the same after a round trip through the writer', () => {
    const text = recommendedRulesText();
    expect(userRules(changedRulesText(text, {}))).toEqual(RECOMMENDED_RULES);
  });

  it('give exactly the verdicts Spark gave before the rules file, case by case', async () => {
    await writeFile(files.user, recommendedRulesText());
    const { rules, problems } = await loadSparkRules(files);
    expect(problems).toEqual([]);
    const found = verdicts(rules);
    expect(Object.keys(found)).toHaveLength(Object.keys(FIXTURE.verdicts).length);
    for (const [key, decision] of Object.entries(found)) {
      expect(withoutMarker(decision), key).toEqual(before(key));
    }
  });

  it('cover every verdict kind in the recorded corpus', () => {
    const kinds = new Set(Object.values(FIXTURE.verdicts).map((entry) => entry.verdict));
    expect([...kinds].sort()).toEqual(['allow', 'ask', 'reject']);
  });
});
