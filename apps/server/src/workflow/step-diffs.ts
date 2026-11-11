import { diffLines } from 'diff';
import { STEP_DIFF_PATH_CHARS, type StepDiff } from '@spark-outpost/contracts';
import { storableText } from '../audit/redact.ts';
import { redactSecrets } from '../audit/redact-stream.ts';
import type { ProviderDiff } from '../providers/provider.ts';
import { createDiffBudget } from './diff-budget.ts';

export const STEP_DIFFS_MAX = 20;
const COUNT_TIMEOUT_MS = 50;

function lineCount(text: string | null): number {
  if (!text) return 0;
  const lines = text.split('\n').length;
  return text.endsWith('\n') ? lines - 1 : lines;
}

function changedLines(oldText: string | null, newText: string): { added: number; removed: number } {
  const parts =
    oldText === null ? undefined : diffLines(oldText, newText, { timeout: COUNT_TIMEOUT_MS });
  if (!parts) return { added: lineCount(newText), removed: lineCount(oldText) };
  let added = 0;
  let removed = 0;
  for (const part of parts) {
    if (part.added) added += part.count;
    if (part.removed) removed += part.count;
  }
  return { added, removed };
}

export function stepDiffs(
  diffs: readonly ProviderDiff[],
  secretValues: readonly string[],
): StepDiff[] {
  const budget = createDiffBudget();
  const text = (value: string) => storableText(redactSecrets(value, secretValues));
  return diffs.slice(0, STEP_DIFFS_MAX).map((diff): StepDiff => {
    const path = text(diff.path).slice(-STEP_DIFF_PATH_CHARS);
    if ('withheld' in diff) return { path, added: 0, removed: 0, withheld: true };
    const counts = changedLines(diff.oldText, diff.newText);
    const shownOld = diff.oldText === null ? null : text(diff.oldText);
    const shownNew = text(diff.newText);
    const oldText = shownOld === null ? null : budget.cut(shownOld);
    const newText = budget.cut(shownNew);
    const whole = (oldText?.length ?? 0) + newText.length;
    const original = (shownOld?.length ?? 0) + shownNew.length;
    return {
      path,
      ...counts,
      oldText,
      newText,
      ...(whole < original ? { truncated: true } : {}),
    };
  });
}
