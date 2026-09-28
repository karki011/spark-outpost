import { checkLine, type CheckBody, type ReviewVerdict } from '@spark-outpost/contracts';
import type { MemberResult } from './session.ts';

const VERDICTS: Record<ReviewVerdict, string> = {
  looks_good: 'looks good',
  concerns: 'concerns',
  unclear: 'unclear',
};

export function latestChecks(bodies: readonly CheckBody[]): CheckBody[] {
  const latest = new Map<string, CheckBody>();
  for (const body of bodies) latest.set(`${body.name}:${body.copy ?? ''}`, body);
  return [...latest.values()];
}

export function finalText(
  results: readonly MemberResult[],
  verdict: ReviewVerdict | null,
  findings: readonly string[],
  hasMessage: boolean,
  checks: readonly CheckBody[] = [],
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
  if (worker?.text.trim()) parts.push(worker.text.trim());
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
