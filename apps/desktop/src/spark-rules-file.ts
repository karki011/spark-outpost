import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { SparkRulesOpenResult } from '@spark-outpost/contracts';

const MISSING = "settings.json isn't there. Use recommended rules to write it again.";

export function userRulesFile(env: NodeJS.ProcessEnv, defaultFile: string): string {
  const override = env.SPARK_RULES_FILE?.trim();
  return override && isAbsolute(override) ? override : defaultFile;
}

export async function openRulesFile(
  file: string,
  open: (file: string) => Promise<string>,
): Promise<SparkRulesOpenResult> {
  const found = await stat(file).catch(() => null);
  if (!found?.isFile()) return { opened: false, error: MISSING };
  const error = await open(file);
  return error ? { opened: false, error } : { opened: true };
}
