import { failingChecks, type CheckBody } from '@spark-outpost/contracts';
import { checkFailureText } from './context.ts';

export function checkLines(body: CheckBody | null): string[] {
  if (!body) return [];
  const lines = body.results.map((result) => {
    const status =
      result.outcome === 'passed'
        ? 'passed'
        : result.outcome === 'failed'
          ? `failed (exit ${result.exitCode ?? '?'})`
          : result.outcome.replace('_', ' ');
    return `- \`${result.command}\` ${status}`;
  });
  const failing = failingChecks(body);
  if (failing.length > 0) lines.push('', checkFailureText(failing));
  return lines;
}
