import { redacted, redactText, sensitiveFieldKind } from '@spark-outpost/contracts';
import { isSecretPath } from '../projects/path-policy.ts';

export {
  isSensitiveEnvKey,
  redacted,
  REDACTED_MARKER,
  redactText,
  secretKinds,
  sensitiveFieldKind,
} from '@spark-outpost/contracts';

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function storableText(text: string): string {
  return text.replaceAll('\u0000', '\uFFFD').replace(LONE_SURROGATE, '\uFFFD');
}

export function redactValue(value: unknown): unknown {
  return redactValueWithin(value, Number.POSITIVE_INFINITY).value;
}

interface BudgetedRedaction {
  value: unknown;
  clipped: boolean;
}

interface Budget {
  remaining: number;
  clipped: boolean;
}

export function redactValueWithin(value: unknown, maxChars: number): BudgetedRedaction {
  const budget: Budget = { remaining: maxChars, clipped: false };
  const result = redactWithin(value, budget);
  return { value: result, clipped: budget.clipped };
}

function redactWithin(value: unknown, budget: Budget): unknown {
  if (typeof value === 'string') return redactStringWithin(value, budget);
  if (Array.isArray(value)) return value.map((item) => redactWithin(item, budget));
  if (value === null || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const kind = sensitiveFieldKind(key);
    const safeKey = storableText(key);
    budget.remaining -= safeKey.length;
    result[safeKey] =
      kind && child !== null ? spend(redacted(kind), budget) : redactWithin(child, budget);
  }
  return result;
}

function redactStringWithin(text: string, budget: Budget): string {
  const kept = text.length > budget.remaining ? text.slice(0, Math.max(budget.remaining, 0)) : text;
  if (kept.length < text.length) budget.clipped = true;
  return spend(storableText(redactText(kept)), budget);
}

function spend(text: string, budget: Budget): string {
  budget.remaining -= text.length;
  return text;
}

function looksLikeSecretPath(candidate: string): boolean {
  const trimmed = candidate.replace(/^['"`]+|['"`;,)]+$/g, '');
  if (trimmed === '' || trimmed.length > 4096) return false;
  return isSecretPath(trimmed.replaceAll('\\', '/'));
}

const FILE_CONTENT_FIELDS = new Set([
  'content',
  'oldstring',
  'newstring',
  'oldtext',
  'newtext',
  'oldstr',
  'newstr',
  'filetext',
  'newsource',
]);

function isFileContentField(key: string): boolean {
  return FILE_CONTENT_FIELDS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''));
}

export function mentionsSecretFile(value: unknown): boolean {
  if (typeof value === 'string') return value.split(/[\s=<>|&]+/).some(looksLikeSecretPath);
  if (Array.isArray(value)) return value.some(mentionsSecretFile);
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, child]) => !isFileContentField(key) && mentionsSecretFile(child),
  );
}
