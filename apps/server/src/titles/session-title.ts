import { RENAMED_TITLE_MAX_LENGTH, clipAtWord } from '@spark-outpost/contracts';
import { DEFAULT_SESSION_NAME } from '../agents/acp/session-name.ts';
import { redactSecrets } from '../audit/redact-stream.ts';
import type { ProviderOutput } from '../providers/provider.ts';

const flatten = (text: string) =>
  text
    .replace(/\p{Cf}/gu, '')
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .trim();

export function cleanSessionTitle(raw: string, secretValues: readonly string[]): string | null {
  const redacted = flatten(redactSecrets(flatten(raw), secretValues));
  const title = clipAtWord(redacted, RENAMED_TITLE_MAX_LENGTH);
  return title === '' ? null : title;
}

export interface SessionTitleWatch {
  see(output: ProviderOutput): void;
  latest(): string | null;
}

export function createSessionTitleWatch(
  secretValues: readonly string[],
  sentTitle: string | null | undefined,
): SessionTitleWatch {
  const echoes = new Set([DEFAULT_SESSION_NAME, sentTitle].map((sent) => flatten(sent ?? '')));
  let latest: string | null = null;
  return {
    see(output) {
      if (output.kind !== 'session_title') return;
      const title = cleanSessionTitle(output.title, secretValues);
      if (title !== null && !echoes.has(title)) latest = title;
    },
    latest: () => latest,
  };
}
