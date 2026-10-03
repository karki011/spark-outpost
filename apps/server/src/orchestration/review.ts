import type { ReviewVerdict } from '@spark-outpost/contracts';

const VERDICT_LINE = /^\W*verdict\W+(looks good|concerns)\b/i;
const MAX_FINDINGS = 20;

export function reviewVerdict(text: string): ReviewVerdict {
  const verdicts = text
    .split('\n')
    .map((line) => VERDICT_LINE.exec(line.trim())?.[1]?.toLowerCase())
    .filter((value): value is string => value !== undefined);
  const last = verdicts.at(-1);
  if (last === 'looks good') return 'looks_good';
  if (last === 'concerns') return 'concerns';
  return 'unclear';
}

export function reviewFindings(text: string): string[] {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^\W*findings\W*$/i.test(line.trim()));
  const body = start === -1 ? lines : lines.slice(start + 1);
  return body
    .map((line) => /^\s*(?:[-*]|\d+\.)\s+(.*\S)\s*$/.exec(line)?.[1])
    .filter((finding): finding is string => finding !== undefined)
    .slice(0, MAX_FINDINGS);
}

const RESOLVED_TAG = /^\W*\[(?:fixed|resolved|addressed)\]/i;
const RESOLVED_LEAD =
  /^\W*(?:\[\w+\]\s*)?(?:(?:now|already)\s+)?(?:fixed|resolved|addressed)\s*(?:[:.,;—–]|\s-\s|$)/i;

export function isResolvedFinding(finding: string): boolean {
  return RESOLVED_TAG.test(finding) || RESOLVED_LEAD.test(finding);
}

export function openFindings(findings: readonly string[]): string[] {
  return findings.filter((finding) => !isResolvedFinding(finding));
}
