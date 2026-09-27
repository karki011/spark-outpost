import path from 'node:path';
import type { BuildStyle } from '@spark-outpost/contracts';
import { architectStyle, builderStyle, criticStyle } from './lean.ts';

export const REQUEST_LIMIT = 8_000;
export const HISTORY_TURNS = 6;
export const HISTORY_TURN_LIMIT = 1_000;
export const PATCH_LIMIT = 24_000;
export const NOTE_LIMIT = 2_000;
export const FINDINGS_LIMIT = 10;
export const RESEARCH_LIMIT = 4_000;
export const ARCHITECT_NOTES_LIMIT = 4_000;
export const CHECK_OUTPUT_LIMIT = 3_000;

export interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChangedFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface ArchitectContext {
  request: string;
  history: readonly HistoryTurn[];
  repos: readonly string[];
  previousPlan: readonly string[];
  note: string | null;
  buildStyle?: BuildStyle;
}

export interface ArchitectNotes {
  files: readonly string[];
  text: string;
}

export interface BuilderContext {
  request: string;
  plan: readonly string[];
  stepIndex: number;
  carry?: readonly number[] | undefined;
  architectNotes?: ArchitectNotes | null;
  earlierChanges: readonly ChangedFile[];
  note: string | null;
  findings: readonly string[];
  research?: readonly ResearchNote[];
  conflict?: string;
  checkFailures?: string;
  buildStyle?: BuildStyle;
}

export interface ResearchNote {
  name: string;
  step: string;
  text: string;
}

export interface ScoutContext {
  request: string;
  plan: readonly string[];
  stepIndex: number;
}

export interface ReviewSubject {
  name: string;
  steps: readonly number[];
}

export interface CriticContext {
  request: string;
  plan: readonly string[];
  changes: readonly ChangedFile[];
  patch: string;
  checks: readonly string[];
  subject?: ReviewSubject | null;
  buildStyle?: BuildStyle;
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

function numbered(steps: readonly string[], mine: readonly number[] = []): string {
  return steps
    .map((step, index) => {
      const [head, ...rest] = step.split('\n');
      const marker = mine.includes(index) ? '  <- your step' : '';
      return [`${index + 1}. ${head}${marker}`, ...rest.map((line) => `   ${line}`)].join('\n');
    })
    .join('\n');
}

function changeLines(changes: readonly ChangedFile[]): string {
  if (changes.length === 0) return 'No files changed yet.';
  return changes.map((file) => `- ${file.path} (+${file.additions} -${file.deletions})`).join('\n');
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

export function architectPrompt(context: ArchitectContext): string {
  const parts = [
    'Role: Architect. You plan; you do not change files. Read the linked repos as needed.',
    'Record your plan with your plan or todo tool as 2 to 6 concrete, ordered steps. End each step with "Files: a.ts, b.ts" listing only the files that step creates or changes, not files it only reads or imports from. Then reply with a short summary of the plan.',
    'After the summary, list every step on its own line, numbered as in your plan, with the files it creates or changes and the earlier steps it needs, for example "Step 3 · Files: src/csv.ts, test/csv.test.ts · Depends on: 1" or "Step 1 · Files: src/a.ts · Depends on: none".',
    'Independent work runs at the same time, each chain with its own Builder. If the steps form independent chains that change different files and need nothing from each other, name each chain on its own line, such as "Chain A: steps 1-3" and "Chain B: steps 4-6". A step that needs more than one chain comes after them and belongs to no chain. A step that only reads or researches starts with "Research:".',
    'A chain only gets its own Builder when it is large: two or more of its steps (or its only step) take more than about 20 seconds each, or it changes five or more files. Smaller chains are done in order by one Builder. Add a line such as "Large: 2, 3" naming the steps you expect to take that long. When you name chains, add "Parallel chains: yes" if separate Builders should do them at the same time, or "Parallel chains: no" if one Builder doing them in order is as good.',
    'Finally, write a "Notes for Builders:" line followed by what the Builders need so they do not re-read the files you read: exact signatures, import lines and short excerpts, each with its file path. Keep the notes under 3,000 characters.',
    ...optional(architectStyle(context.buildStyle ?? 'off')),
    section('Request', cap(context.request, REQUEST_LIMIT)),
    section('Earlier conversation', historyLines(context.history)),
    section('Repos', context.repos.map((repo) => `- ${path.basename(repo)}`).join('\n') || 'None.'),
  ];
  if (context.previousPlan.length > 0) {
    parts.push(section('Your previous plan', numbered(context.previousPlan)));
  }
  if (context.note)
    parts.push(section('Change requested by the user', cap(context.note, NOTE_LIMIT)));
  return parts.join('\n\n');
}

const ONE_STEP =
  'Role: Builder. Make the change for your step only, then reply with what you changed.';
const CARRIED_STEPS =
  'Role: Builder. Make the changes for your steps in plan order, then reply with what you changed. When you finish a step, write "Step N done." on its own line, where N is its number in the plan.';

function ownSteps(context: BuilderContext): number[] {
  const mine = context.carry && context.carry.length > 1 ? context.carry : [context.stepIndex];
  return mine.filter((index) => context.plan[index]?.trim());
}

function stepSections(context: BuilderContext, mine: readonly number[]): string[] {
  const texts = mine.map((index) => context.plan[index]!.trim());
  const own =
    mine.length > 1
      ? section('Your steps', mine.map((index, at) => `Step ${index + 1}: ${texts[at]}`).join('\n'))
      : section('Your step', texts[0]!);
  const parts = [section('Plan', numbered(context.plan, mine)), own];
  const files = namedFiles(texts);
  if (files.length > 0)
    parts.push(section('Files the plan names', files.map((file) => `- ${file}`).join('\n')));
  return parts;
}

const NOTES_LINE = /^[\s*_#>-]*notes for builders[\s*_]*:?[\s*_]*/im;
const HINT_LINE = /^[\s*_#>-]*(?:parallel|large|chain\s+[\w-]+[^:\n]*)[\s*_]*:.*$/gim;
const READ_TOOL = /^Read\b/;

export function readFiles(toolNames: readonly string[]): string[] {
  const files = toolNames
    .filter((name) => READ_TOOL.test(name))
    .flatMap((name) => [...name.matchAll(/`([^`]+)`/g)].map((match) => match[1]!));
  return [...new Set(files)].slice(0, 40);
}

export function architectNotes(reply: string, files: readonly string[]): ArchitectNotes | null {
  const marker = NOTES_LINE.exec(reply);
  const body = marker ? reply.slice(marker.index + marker[0].length) : reply;
  const text = body.replace(HINT_LINE, '').trim();
  if (!text && files.length === 0) return null;
  return { files: [...files], text };
}

function notesText(notes: ArchitectNotes): string {
  const read = notes.files.length > 0 ? `Files it read: ${notes.files.join(', ')}\n\n` : '';
  return cap(`${read}${notes.text}`, ARCHITECT_NOTES_LIMIT);
}

export function builderPrompt(context: BuilderContext): string {
  const mine = ownSteps(context);
  const parts = [
    mine.length > 1 ? CARRIED_STEPS : ONE_STEP,
    section('Request', cap(context.request, REQUEST_LIMIT)),
  ];
  if (mine.length > 0) parts.push(...stepSections(context, mine));
  if (context.architectNotes) {
    parts.push(section('Notes from the Architect', notesText(context.architectNotes)));
  }
  parts.push(section('Changed by earlier steps', changeLines(context.earlierChanges)));
  if (context.research && context.research.length > 0) {
    const notes = context.research.map(
      (note) => `${note.name} (${cap(note.step, 200)}):\n${cap(note.text, RESEARCH_LIMIT)}`,
    );
    parts.push(section('Notes from Scouts', notes.join('\n\n')));
  }
  if (context.findings.length > 0) {
    const findings = context.findings
      .slice(0, FINDINGS_LIMIT)
      .map((finding) => `- ${cap(finding, 500)}`);
    parts.push(section('Review findings to address', findings.join('\n')));
  }
  if (context.conflict) {
    parts.push(section('Conflicting changes to reconcile', cap(context.conflict, PATCH_LIMIT)));
  }
  if (context.checkFailures) {
    parts.push(section('Failing checks', cap(context.checkFailures, CHECK_OUTPUT_LIMIT)));
  }
  if (context.note) parts.push(section('Note from the user', cap(context.note, NOTE_LIMIT)));
  parts.push(...optional(builderStyle(context.buildStyle ?? 'off')));
  return parts.join('\n\n');
}

export function scoutPrompt(context: ScoutContext): string {
  const step = context.plan[context.stepIndex]?.trim() ?? '';
  return [
    'Role: Scout. Research your question only; do not change files. Reply with what you found, citing files.',
    section('Request', cap(context.request, REQUEST_LIMIT)),
    section('Plan', numbered(context.plan, [context.stepIndex])),
    section('Your question', step || 'Research the request.'),
  ].join('\n\n');
}

const VERDICT_RULE =
  'List findings as "- " bullets under a "Findings:" line, then end with exactly one line: "Verdict: looks good" or "Verdict: concerns".';

function stepRange(steps: readonly number[]): string {
  const numbers = steps.map((index) => index + 1);
  if (numbers.length === 1) return `step ${numbers[0]}`;
  return `steps ${numbers.join(', ')}`;
}

function subjectLine(subject: ReviewSubject): string {
  return `${subject.name}'s change for ${stepRange(subject.steps)}. Other Builders may still be working; review only this diff.`;
}

function reviewSections(context: Omit<CriticContext, 'request' | 'plan'>): string[] {
  return [
    ...(context.subject ? [section('Change under review', subjectLine(context.subject))] : []),
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

export function criticPrompt(context: CriticContext): string {
  return [
    'Role: Critic. Review the change below; do not change files. This is an AI review, not verification.',
    VERDICT_RULE,
    ...optional(criticStyle(context.buildStyle ?? 'off')),
    section('Request', cap(context.request, REQUEST_LIMIT)),
    section('Plan', context.plan.length > 0 ? numbered(context.plan) : 'No plan was made.'),
    ...reviewSections(context),
  ].join('\n\n');
}

export function criticFollowUp(context: Omit<CriticContext, 'request' | 'plan'>): string {
  return [
    'Review the next change the same way; do not change files.',
    VERDICT_RULE,
    ...optional(criticStyle(context.buildStyle ?? 'off')),
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
    "Role: Builder. The project's checks failed after your change. Fix the cause without undoing your step's intent, then reply with what you changed.",
    section('Failing checks', cap(failures, CHECK_OUTPUT_LIMIT)),
  ].join('\n\n');
}
