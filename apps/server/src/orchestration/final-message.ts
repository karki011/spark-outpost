import { checkLine, type CheckBody, type ReviewVerdict } from '@spark-outpost/contracts';
import { latestChecks } from './check-results.ts';
import type { SpawnReason } from './flow-types.ts';
import type { MemberResult } from './session.ts';

const BUILDS: ReadonlySet<SpawnReason> = new Set(['first', 'retry']);
const LATER_TURNS: ReadonlySet<SpawnReason> = new Set(['fix']);
const CONTINUES: ReadonlySet<SpawnReason> = new Set(['continue', 'resume', 'escalate']);
const LINE_CHARACTERS = 200;

const VERDICTS: Record<ReviewVerdict, string> = {
  looks_good: 'looks good',
  concerns: 'concerns',
  unclear: 'unclear',
};

function firstSentence(text: string): string | null {
  const line = text
    .split('\n')
    .map((entry) => entry.replace(/^[\s>*#-]+/, '').trim())
    .find((entry) => entry !== '');
  if (!line) return null;
  const sentence = /^.*?[.!?](?=\s|$)/.exec(line)?.[0] ?? line;
  return sentence.length > LINE_CHARACTERS ? `${sentence.slice(0, LINE_CHARACTERS)}…` : sentence;
}

function mainBuild(builders: readonly MemberResult[]): MemberResult | undefined {
  return builders.findLast((result) => result.reason && BUILDS.has(result.reason)) ?? builders[0];
}

export function laterTurnsLine(builders: readonly MemberResult[]): string | null {
  const main = mainBuild(builders);
  if (!main) return null;
  const later = builders
    .slice(builders.indexOf(main) + 1)
    .filter((result) => result.reason && LATER_TURNS.has(result.reason))
    .flatMap((result) => firstSentence(result.text) ?? []);
  if (later.length === 0) return null;
  return `Fixes after review and checks: ${later.join(' ')}`;
}

function leadText(children: readonly MemberResult[], summary: string | null): string | undefined {
  const builders = children.filter((result) => result.role === 'builder');
  const main = mainBuild(builders);
  if (summary) return summary;
  const later = laterTurnsLine(builders);
  if (!main) return children.findLast((result) => result.role === 'scout')?.text.trim();
  const continued = builders
    .slice(builders.indexOf(main) + 1)
    .filter((result) => result.reason && CONTINUES.has(result.reason))
    .map((result) => result.text.trim());
  return [main.text.trim(), ...continued, later].filter(Boolean).join('\n\n');
}

export function finalText(
  results: readonly MemberResult[],
  verdict: ReviewVerdict | null,
  findings: readonly string[],
  hasMessage: boolean,
  checks: readonly CheckBody[] = [],
  summary: string | null = null,
): string {
  const children = results.filter((result) => !result.inPlace && result.outcome === 'succeeded');
  const latest = latestChecks(checks);
  const failing = latest.some((body) => body.status === 'failed');
  if (children.length === 0 && !failing) return '';
  const worker = children.findLast(
    (result) => result.role === 'builder' || result.role === 'scout',
  );
  const critic = children.findLast((result) => result.role === 'critic');
  const parts: string[] = [];
  const lead = leadText(children, summary) ?? worker?.text.trim();
  if (lead) parts.push(lead);
  if (latest.length > 0) parts.push(latest.map(checkLine).join('\n'));
  const reviewOnly = !worker && critic?.text.trim();
  if (critic && reviewOnly) parts.push(critic.text.trim());
  if (critic && verdict) {
    const lines = [`AI review by ${critic.label}: ${VERDICTS[verdict]}.`];
    if (!reviewOnly) lines.push(...findings.slice(0, 5).map((finding) => `- ${finding}`));
    parts.push(lines.join('\n'));
  }
  if (parts.length === 0) return '';
  return `${hasMessage ? '\n\n' : ''}${parts.join('\n\n')}`;
}
