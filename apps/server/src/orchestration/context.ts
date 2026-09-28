import type { BuildStyle } from '@spark-outpost/contracts';
import { builderStyle, criticStyle } from './lean.ts';

export const REQUEST_LIMIT = 8_000;
export const HISTORY_TURNS = 6;
export const HISTORY_TURN_LIMIT = 1_000;
export const PATCH_LIMIT = 24_000;
export const NOTE_LIMIT = 2_000;
export const FINDINGS_LIMIT = 10;
export const CHECK_OUTPUT_LIMIT = 3_000;

export interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChangedFile {
  path: string;
  additions: number;
  deletions: number;
  origin?: 'task' | 'before' | 'both';
}

export interface BuilderContext {
  request: string;
  history: readonly HistoryTurn[];
  note: string | null;
  findings: readonly string[];
  buildStyle?: BuildStyle;
  checkCommands?: readonly string[];
  agreedPlan?: string | null;
}

export interface CriticContext {
  request: string;
  plan: readonly string[];
  changes: readonly ChangedFile[];
  patch: string;
  checks: readonly string[];
  buildStyle?: BuildStyle;
  agreedPlan?: string | null;
  previousFindings?: readonly string[];
}

function optional(text: string | null): string[] {
  return text ? [text] : [];
}

function cap(text: string, limit: number): string {
  const trimmed = text.trim();
  return trimmed.length > limit
    ? `${trimmed.slice(0, limit)}\n[cut at ${limit} characters]`
    : trimmed;
}

function section(title: string, body: string): string {
  return `## ${title}\n${body}`;
}

function numbered(steps: readonly string[]): string {
  return steps.map((step, index) => `${index + 1}. ${step}`).join('\n');
}

const ORIGIN_NOTES = {
  task: '',
  before: ', changed before this task',
  both: ', changed before and during this task',
} as const;

function changeLines(changes: readonly ChangedFile[]): string {
  if (changes.length === 0) return 'No files changed yet.';
  return changes
    .map(
      (file) =>
        `- ${file.path} (+${file.additions} -${file.deletions}${ORIGIN_NOTES[file.origin ?? 'task']})`,
    )
    .join('\n');
}

const PATH_TOKEN =
  /(?:^|[\s`'"(])((?:[\w.-]+\/)+[\w.-]+\.\w+|[\w-]+\.(?:ts|tsx|js|jsx|json|md|sql|css|html|py|rs|go|yaml|yml|toml))(?=$|[\s`'"),:;]|\.(?:\s|$))/g;

export function namedFiles(steps: readonly string[]): string[] {
  const found = new Set<string>();
  for (const step of steps) {
    for (const match of step.matchAll(PATH_TOKEN)) found.add(match[1]!);
  }
  return [...found].slice(0, 20);
}

function historyLines(history: readonly HistoryTurn[]): string {
  const recent = history.slice(-HISTORY_TURNS);
  if (recent.length === 0) return 'No earlier messages.';
  return recent
    .map(
      (turn) =>
        `${turn.role === 'user' ? 'User' : 'Assistant'}: ${cap(turn.content, HISTORY_TURN_LIMIT)}`,
    )
    .join('\n\n');
}

export const INCREMENT_RULE =
  'Work in a small increment: make this change and stop. If the request is a whole feature, do the first useful slice, say in one line what is left, and stop there. Plan for yourself only when the change needs several steps.';

export const SHIP_RULE =
  "Leave the change in the working tree. Don't commit, push, open a pull request, run `gh`, or change git remotes: Spark Outpost commits, pushes and opens the draft PR itself when the task is done, even when the request says to ship it.";

function checkSection(commands: readonly string[] | undefined): string[] {
  if (!commands || commands.length === 0) return [];
  return [
    section(
      'Checks the harness runs after you',
      commands.map((command) => `- \`${command}\``).join('\n'),
    ),
  ];
}

export function builderPrompt(context: BuilderContext): string {
  const parts = [
    'Role: Builder. Make the change the request asks for, then reply with what you changed.',
    INCREMENT_RULE,
    SHIP_RULE,
    section('Request', cap(context.request, REQUEST_LIMIT)),
  ];
  if (context.agreedPlan) parts.push(context.agreedPlan);
  if (context.history.length > 0) {
    parts.push(section('Earlier conversation', historyLines(context.history)));
  }
  if (context.findings.length > 0) {
    const findings = context.findings
      .slice(0, FINDINGS_LIMIT)
      .map((finding) => `- ${cap(finding, 500)}`);
    parts.push(section('Review findings to address', findings.join('\n')));
  }
  if (context.note) parts.push(section('Note from the user', cap(context.note, NOTE_LIMIT)));
  parts.push(...checkSection(context.checkCommands));
  parts.push(...optional(builderStyle(context.buildStyle ?? 'off')));
  return parts.join('\n\n');
}

export function fixFollowUp(note: string | null): string {
  return note
    ? `The user asked for a fix:\n\n${cap(note, NOTE_LIMIT)}\n\nMake it, then reply with what you changed.`
    : 'The user asked for a fix. Look again at your change, fix what is wrong, then reply with what you changed.';
}

export const PLAN_FOLLOW_RULE =
  'The user agreed the plan below. Add one finding that says whether the changes follow it, naming any step they skip or contradict.';

const VERDICT_RULE =
  'List findings as "- " bullets under a "Findings:" line, then end with exactly one line: "Verdict: looks good" or "Verdict: concerns".';

function reviewSections(context: Omit<CriticContext, 'request' | 'plan'>): string[] {
  return [
    section('Files changed', changeLines(context.changes)),
    section(
      'Diff',
      context.patch.trim() ? `\`\`\`diff\n${cap(context.patch, PATCH_LIMIT)}\n\`\`\`` : 'No diff.',
    ),
    section(
      'Check results',
      context.checks.length > 0 ? context.checks.join('\n') : 'No checks ran.',
    ),
  ];
}

function previousFindingsSection(findings: readonly string[]): string[] {
  if (findings.length === 0) return [];
  const lines = findings.slice(0, FINDINGS_LIMIT).map((finding) => `- ${cap(finding, 500)}`);
  return [
    section(
      'Findings the Builder was asked to fix',
      `Check whether each is fixed now. Repeat any that remain in the same words.\n${lines.join('\n')}`,
    ),
  ];
}

export function criticPrompt(context: CriticContext): string {
  return [
    'Role: Critic. Review the change below; do not change files. This is an AI review, not verification.',
    VERDICT_RULE,
    ...optional(criticStyle(context.buildStyle ?? 'off')),
    ...(context.agreedPlan ? [PLAN_FOLLOW_RULE] : []),
    section('Request', cap(context.request, REQUEST_LIMIT)),
    ...optional(context.agreedPlan ?? null),
    section('Plan', context.plan.length > 0 ? numbered(context.plan) : 'No plan was made.'),
    ...previousFindingsSection(context.previousFindings ?? []),
    ...reviewSections(context),
  ].join('\n\n');
}

export interface FailingCheck {
  command: string;
  outcome: string;
  exitCode: number | null;
  outputTail: string;
}

function failureStatus(check: FailingCheck): string {
  if (check.outcome === 'timed_out') return 'timed out';
  return `exited ${check.exitCode ?? 'with an error'}`;
}

export function checkFailureText(checks: readonly FailingCheck[]): string {
  const share = Math.floor(CHECK_OUTPUT_LIMIT / Math.max(1, checks.length));
  return checks
    .map((check) => {
      const tail = check.outputTail.trim();
      const shown = tail.length > share ? `…${tail.slice(tail.length - share)}` : tail;
      return `\`${check.command}\` ${failureStatus(check)}:\n\`\`\`text\n${shown || '(no output)'}\n\`\`\``;
    })
    .join('\n\n');
}

export function checkFixFollowUp(failures: string): string {
  return [
    "The project's checks failed after your change. Fix the cause without undoing the change's intent, then reply with what you changed.",
    section('Failing checks', cap(failures, CHECK_OUTPUT_LIMIT)),
  ].join('\n\n');
}

export const CRITIC_FIX_LEAD =
  "The AI review of your change found these correctness problems. Fix each one without undoing the change's intent, add or adjust a test that shows it where the project has tests, then reply with what you changed.";

export function criticFixFollowUp(findings: readonly string[]): string {
  const lines = findings.slice(0, FINDINGS_LIMIT).map((finding) => `- ${cap(finding, 500)}`);
  return [CRITIC_FIX_LEAD, section('Review findings to fix', lines.join('\n'))].join('\n\n');
}
