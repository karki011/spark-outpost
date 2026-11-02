import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import { recommendedRulesText } from '../src/spark-rules/recommended.ts';

const dir = mkdtempSync(join(tmpdir(), 'spark-outpost-test-rules-'));
process.env.SPARK_RULES_FILE = join(dir, 'settings.json');
process.env.SPARK_MANAGED_RULES_FILE = join(dir, 'managed-settings.json');
writeFileSync(process.env.SPARK_RULES_FILE, recommendedRulesText());

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
