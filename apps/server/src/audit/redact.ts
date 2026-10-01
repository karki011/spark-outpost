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
  if (typeof value === 'string') return storableText(redactText(value));
  if (Array.isArray(value)) return value.map(redactValue);
  if (value === null || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const kind = sensitiveFieldKind(key);
    result[storableText(key)] = kind && child !== null ? redacted(kind) : redactValue(child);
  }
  return result;
}

function looksLikeSecretPath(candidate: string): boolean {
  const trimmed = candidate.replace(/^['"`]+|['"`;,)]+$/g, '');
  if (trimmed === '' || trimmed.length > 4096) return false;
  return isSecretPath(trimmed.replaceAll('\\', '/'));
}

export function mentionsSecretFile(value: unknown): boolean {
  if (typeof value === 'string') return value.split(/[\s=<>|&]+/).some(looksLikeSecretPath);
  if (Array.isArray(value)) return value.some(mentionsSecretFile);
  if (value === null || typeof value !== 'object') return false;
  return Object.values(value).some(mentionsSecretFile);
}
