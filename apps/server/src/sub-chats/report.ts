import {
  ALSO_SAID,
  NONE_STATED,
  REPORT_FOOTER,
  SUB_CHAT_STATUS_WORDS,
  type SubChatPullRequest,
  type SubChatReport,
  type SubChatStatus,
  type TerminalRunStatus,
} from '@spark-outpost/contracts';

export const REPORT_SHAPE =
  'End your reply with three labelled sections, each on its own line: "Changed:" (what you changed), "Risks:" (what could go wrong or needs a careful look) and "Blockers:" (what stopped you or needs the user). Write "None" where there is nothing to say. Do not report the branch or pull request: Spark adds its own record of them.';

export const TURN_REASONS = {
  failed: 'Its turn failed.',
  stopped: 'Its turn was stopped.',
  gone: 'Its turn is gone.',
} as const;

const SECTION_MAX = 4000;
const SAID_MAX = 6000;
const REASON_MAX = 300;
const OPENING_LINES = 6;
const LABEL_LINE = /^[\s>*_#-]*(changed|risks|blockers)[*_]*\s*:[*_]*\s*(.*)$/i;
const BULLET = /^\s*[-*+]\s+/;
const OTHER_LABEL_LINE =
  /^\s*(?:#{1,6}\s+\S|(?:>\s*)?(?:\*\*|__)?[A-Z][A-Za-z]*(?: [A-Za-z]+){0,3}(?:\*\*|__)?\s*:(?:\*\*|__)?(?:\s|$))/;

type Section = 'changed' | 'risks' | 'blockers';

export interface ReportTurn {
  status: TerminalRunStatus | 'gone';
  reply: string;
  error: string | null;
}

export interface ReportFacts {
  status: SubChatStatus;
  branch: string | null;
  committed: boolean;
  pushed: boolean;
  pullRequest: SubChatPullRequest | null;
}

function clipped(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function sectionsOf(reply: string): { found: Map<Section, string>; rest: string[] } {
  const lines = new Map<Section, string[]>();
  const rest: string[] = [];
  let current: string[] = rest;
  let bulletList = false;
  for (const line of reply.split('\n')) {
    const label = LABEL_LINE.exec(line);
    if (label) {
      const section = label[1]!.toLowerCase() as Section;
      current = lines.get(section) ?? [];
      lines.set(section, current);
      current.push(label[2] ?? '');
      bulletList = (label[2] ?? '').trim() === '';
      continue;
    }
    const bulleted = BULLET.test(line);
    const item = bulleted && bulletList;
    if (!item && OTHER_LABEL_LINE.test(line.replace(BULLET, ''))) current = rest;
    if (!bulleted && line.trim() !== '') bulletList = false;
    current.push(line);
  }
  const found = new Map<Section, string>();
  for (const [section, text] of lines) {
    const body = clipped(text.join('\n'), SECTION_MAX);
    if (body) found.set(section, body);
  }
  return { found, rest };
}

function unlabelled(rest: readonly string[]): { changed: string; said: string } {
  const opening: string[] = [];
  const after: string[] = [];
  for (const line of rest) {
    if (opening.length < OPENING_LINES && line.trim() !== '') opening.push(line);
    else if (opening.length >= OPENING_LINES) after.push(line);
  }
  return {
    changed: clipped(opening.join('\n'), SECTION_MAX),
    said: clipped(after.join('\n'), SAID_MAX),
  };
}

function turnReason(turn: Pick<ReportTurn, 'status' | 'error'>): string | null {
  if (turn.status === 'succeeded') return null;
  if (turn.status === 'cancelled') return TURN_REASONS.stopped;
  if (turn.status === 'gone') return TURN_REASONS.gone;
  const error = clipped((turn.error ?? '').replace(/\s+/g, ' '), REASON_MAX);
  return error ? `Its turn failed: ${error}` : TURN_REASONS.failed;
}

export function buildReport(turn: ReportTurn, facts: ReportFacts): SubChatReport {
  const { found, rest } = sectionsOf(turn.reply);
  const reason = turnReason(turn);
  const loose =
    found.size === 0 ? unlabelled(rest) : { changed: '', said: clipped(rest.join('\n'), SAID_MAX) };
  return {
    status: reason === null ? facts.status : 'needs_you',
    reason,
    changed: found.get('changed') ?? (loose.changed || NONE_STATED),
    risks: found.get('risks') ?? NONE_STATED,
    blockers: found.get('blockers') ?? NONE_STATED,
    said: loose.said,
    branch: facts.branch,
    committed: facts.committed,
    pushed: facts.pushed,
    pullRequest: facts.pullRequest,
  };
}

function pullWords(pull: SubChatPullRequest): string {
  const checks = pull.checks === 'none' ? '' : `, checks ${pull.checks}`;
  return `pull request #${pull.number} (${pull.state}${checks}) ${pull.url}`;
}

export function recordLine(
  report: Pick<SubChatReport, 'branch' | 'committed' | 'pushed' | 'pullRequest'>,
): string {
  return [
    report.branch ? `branch ${report.branch}` : 'no branch',
    report.committed ? 'committed' : 'not committed',
    report.pushed ? 'pushed' : 'not pushed',
    report.pullRequest ? pullWords(report.pullRequest) : 'no pull request',
  ].join(' · ');
}

export function statusWords(report: Pick<SubChatReport, 'status' | 'reason'>): string {
  const word = SUB_CHAT_STATUS_WORDS[report.status];
  return report.reason ? `${word} (${report.reason})` : word;
}

export function reportText(report: SubChatReport): string {
  return [
    `Status: ${statusWords(report)}`,
    `Changed: ${report.changed}`,
    `Branch and pull request: ${recordLine(report)}`,
    `Risks: ${report.risks}`,
    `Blockers: ${report.blockers}`,
    ...(report.said ? [`${ALSO_SAID}: ${report.said}`] : []),
    REPORT_FOOTER,
  ].join('\n');
}
