import { stat } from 'node:fs/promises';
import type { SparkRulesOpenResult } from '@spark-outpost/contracts';

const MISSING = "settings.json isn't there. Use recommended rules to write it again.";

export async function openRulesFile(
  file: string,
  open: (file: string) => Promise<string>,
): Promise<SparkRulesOpenResult> {
  const found = await stat(file).catch(() => null);
  if (!found?.isFile()) return { opened: false, error: MISSING };
  const error = await open(file);
  return error ? { opened: false, error } : { opened: true };
}
