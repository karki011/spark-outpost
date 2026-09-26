import type { ReviewVerdict } from '@spark-outpost/contracts';
import type { MemberResult } from './session.ts';

const VERDICTS: Record<ReviewVerdict, string> = {
  looks_good: 'looks good',
  concerns: 'concerns',
  unclear: 'unclear',
};

export function finalText(
  results: readonly MemberResult[],
  verdict: ReviewVerdict | null,
  findings: readonly string[],
  hasMessage: boolean,
): string {
  const children = results.filter((result) => !result.inPlace && result.outcome === 'succeeded');
  if (children.length === 0) return '';
  const worker = children.findLast(
    (result) => result.role === 'builder' || result.role === 'scout',
  );
  const architect = children.findLast((result) => result.role === 'architect');
  const critic = children.findLast((result) => result.role === 'critic');
  const parts: string[] = [];
  const main = worker ?? architect;
  if (main?.text.trim()) parts.push(main.text.trim());
  if (critic && verdict) {
    const lines = [`AI review by ${critic.label}: ${VERDICTS[verdict]}.`];
    lines.push(...findings.slice(0, 5).map((finding) => `- ${finding}`));
    parts.push(lines.join('\n'));
  }
  if (parts.length === 0) return '';
  return `${hasMessage ? '\n\n' : ''}${parts.join('\n\n')}`;
}
