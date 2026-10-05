import type { CloneFailureKind } from '@spark-outpost/contracts';
import { redacted, redactText } from '../../audit/redact.ts';

export interface CloneFailure {
  kind: CloneFailureKind;
  summary: string;
  detail: string;
}

const RULES: [CloneFailureKind, RegExp][] = [
  ['disk', /no space left on device|disk quota exceeded|ENOSPC/i],
  [
    'destination',
    /already exists and is not an empty directory|could not create (?:work tree|leading directories)|unable to create|Permission denied$/im,
  ],
  [
    'not_found',
    /repository (?:'[^']*' )?not found|does not appear to be a git repository|does not exist/i,
  ],
  [
    'auth',
    /authentication failed|could not read username|could not read password|terminal prompts disabled|permission denied|host key verification failed|could not read from remote repository|returned error: 40[13]/i,
  ],
  [
    'network',
    /could not resolve host|unable to access|failed to connect|connection (?:timed out|refused|reset)|network is unreachable|operation timed out|early EOF|RPC failed|unexpected disconnect|the remote end hung up/i,
  ],
];

export const CLONE_SUMMARIES: Record<CloneFailureKind, string> = {
  auth: 'Sign-in failed. Check that your GitHub connection or your own git login can read this repository.',
  not_found:
    'Repository not found. Check the address, and that your GitHub connection can see this repository.',
  network: "Couldn't reach the git host. Check your connection, then try again.",
  destination: "Spark couldn't write to the destination folder.",
  disk: 'The disk is full. Free some space, then try again.',
  interrupted: 'Spark quit before this clone finished.',
  other: 'git could not clone this repository.',
};

const DETAIL_LINES = 6;
const PROGRESS_NOISE =
  /^(?:remote: )?(?:Enumerating|Counting|Compressing|Receiving|Resolving|Updating)\b/;

export function classifyCloneFailure(output: string): CloneFailureKind {
  return RULES.find(([, pattern]) => pattern.test(output))?.[0] ?? 'other';
}

export function redactCloneOutput(output: string, secrets: readonly string[]): string {
  let text = output;
  for (const secret of secrets) {
    if (secret) text = text.replaceAll(secret, redacted('github_token'));
  }
  return redactText(text);
}

export function cloneFailure(output: string, secrets: readonly string[]): CloneFailure {
  const kind = classifyCloneFailure(output);
  const lines = redactCloneOutput(output, secrets)
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => line && !PROGRESS_NOISE.test(line));
  return { kind, summary: CLONE_SUMMARIES[kind], detail: lines.slice(-DETAIL_LINES).join('\n') };
}

export function canRetryWithToken(kind: CloneFailureKind): boolean {
  return kind === 'auth' || kind === 'not_found';
}
