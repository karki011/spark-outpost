import { diffLines } from 'diff';
import { STEP_DIFF_PATH_CHARS, type StepDiff } from '@spark-outpost/contracts';
import { storableText } from '../audit/redact.ts';
import { redactSecrets } from '../audit/redact-stream.ts';
import type { ProviderDiff } from '../providers/provider.ts';
import { createDiffBudget } from './diff-budget.ts';

export const STEP_DIFFS_MAX = 20;
export const STEP_DIFF_BUDGET = 16 * 1024;
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

interface Texts {
  oldText: string | null;
  newText: string;
}

const CONTEXT_LINES = 3;

function fits({ oldText, newText }: Texts): boolean {
  return (oldText?.length ?? 0) + newText.length <= STEP_DIFF_BUDGET;
}

function changedPart({ oldText, newText }: Texts): Texts {
  if (oldText === null) return { oldText, newText };
  const before = oldText.split('\n');
  const after = newText.split('\n');
  const limit = Math.min(before.length, after.length);
  let same = 0;
  while (same < limit && before[same] === after[same]) same += 1;
  let tail = 0;
  while (
    tail < limit - same &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1;
  }
  const from = Math.max(0, same - CONTEXT_LINES);
  const drop = Math.max(0, tail - CONTEXT_LINES);
  return {
    oldText: before.slice(from, before.length - drop).join('\n'),
    newText: after.slice(from, after.length - drop).join('\n'),
  };
}

function shares({ oldText, newText }: Texts, left: number): [number, number] {
  const oldLength = oldText?.length ?? 0;
  if (oldLength + newText.length <= left) return [oldLength, newText.length];
  const half = Math.floor(left / 2);
  const oldShare = Math.min(oldLength, Math.max(half, left - newText.length));
  return [oldShare, left - oldShare];
}

export function stepDiffs(
  diffs: readonly ProviderDiff[],
  secretValues: readonly string[],
): StepDiff[] {
  const budget = createDiffBudget(STEP_DIFF_BUDGET);
  const text = (value: string) => storableText(redactSecrets(value, secretValues));
  return diffs.slice(0, STEP_DIFFS_MAX).map((diff): StepDiff => {
    const path = text(diff.path).slice(-STEP_DIFF_PATH_CHARS);
    if ('withheld' in diff) return { path, added: 0, removed: 0, withheld: true };
    const counts = changedLines(diff.oldText, diff.newText);
    const whole = {
      oldText: diff.oldText === null ? null : text(diff.oldText),
      newText: text(diff.newText),
    };
    const shown = fits(whole) ? whole : changedPart(whole);
    const [oldShare, newShare] = shares(shown, budget.left);
    const oldText = shown.oldText === null ? null : budget.cut(shown.oldText, oldShare);
    const newText = budget.cut(shown.newText, newShare);
    const kept = (oldText?.length ?? 0) + newText.length;
    const original = (whole.oldText?.length ?? 0) + whole.newText.length;
    return {
      path,
      ...counts,
      oldText,
      newText,
      ...(kept < original ? { truncated: true } : {}),
    };
  });
}
