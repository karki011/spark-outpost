import {
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
const REASON_MAX = 300;
const OPENING_LINES = 6;
const LABEL_LINE = /^[\s>*_#-]*(changed|risks|blockers)[*_]*\s*:[*_]*\s*(.*)$/i;

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

function sectionsOf(reply: string): { found: Map<Section, string>; opening: string[] } {
  const lines = new Map<Section, string[]>();
  const opening: string[] = [];
  let current: string[] = opening;
  for (const line of reply.split('\n')) {
    const label = LABEL_LINE.exec(line);
    if (!label) {
      current.push(line);
      continue;
    }
    current = [label[2] ?? ''];
    lines.set(label[1]!.toLowerCase() as Section, current);
  }
  const found = new Map<Section, string>();
  for (const [section, text] of lines) {
    const body = clipped(text.join('\n'), SECTION_MAX);
    if (body) found.set(section, body);
  }
  return { found, opening };
}

function openingOf(lines: readonly string[]): string {
  const said = lines.filter((line) => line.trim() !== '').slice(0, OPENING_LINES);
  return clipped(said.join('\n'), SECTION_MAX);
}

function turnReason(turn: Pick<ReportTurn, 'status' | 'error'>): string | null {
  if (turn.status === 'succeeded') return null;
  if (turn.status === 'cancelled') return TURN_REASONS.stopped;
  if (turn.status === 'gone') return TURN_REASONS.gone;
  const error = clipped((turn.error ?? '').replace(/\s+/g, ' '), REASON_MAX);
  return error ? `Its turn failed: ${error}` : TURN_REASONS.failed;
}

export function buildReport(turn: ReportTurn, facts: ReportFacts): SubChatReport {
  const { found, opening } = sectionsOf(turn.reply);
  const reason = turnReason(turn);
  const unlabelled = found.size === 0 ? openingOf(opening) : '';
  return {
    status: reason === null ? facts.status : 'needs_you',
    reason,
    changed: found.get('changed') ?? (unlabelled || NONE_STATED),
    risks: found.get('risks') ?? NONE_STATED,
    blockers: found.get('blockers') ?? NONE_STATED,
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
    REPORT_FOOTER,
  ].join('\n');
}
