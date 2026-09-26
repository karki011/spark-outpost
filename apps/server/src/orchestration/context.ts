import path from 'node:path';

export const REQUEST_LIMIT = 8_000;
export const HISTORY_TURNS = 6;
export const HISTORY_TURN_LIMIT = 1_000;
export const PATCH_LIMIT = 24_000;
export const NOTE_LIMIT = 2_000;
export const FINDINGS_LIMIT = 10;
export const RESEARCH_LIMIT = 4_000;
export const ARCHITECT_NOTES_LIMIT = 4_000;

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

export interface CriticContext {
  request: string;
  plan: readonly string[];
  changes: readonly ChangedFile[];
  patch: string;
  checks: readonly string[];
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
    .map((step, index) => `${index + 1}. ${step}${mine.includes(index) ? '  <- your step' : ''}`)
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
    'Independent steps can run at the same time. If two or more consecutive steps change different files and need nothing from each other, end your reply with one line such as "Parallel: 2, 3" naming those step numbers; separate several groups with ";". Leave out any step that needs an earlier step\'s result. A step that only reads or researches starts with "Research:".',
    'Parallel steps only get their own Builders when each takes more than about 20 seconds. Add a line such as "Large: 2, 3" naming the steps you expect to take that long; smaller steps run together in one Builder.',
    'After the summary, write a "Notes for Builders:" line followed by what the Builders need so they do not re-read the files you read: exact signatures, import lines and short excerpts, each with its file path. Keep the notes under 3,000 characters.',
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
const HINT_LINE = /^[\s*_#>-]*(?:parallel|large)[\s*_]*:.*$/gim;
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
  if (context.note) parts.push(section('Note from the user', cap(context.note, NOTE_LIMIT)));
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

export function criticPrompt(context: CriticContext): string {
  return [
    'Role: Critic. Review the change below; do not change files. This is an AI review, not verification.',
    'List findings as "- " bullets under a "Findings:" line, then end with exactly one line: "Verdict: looks good" or "Verdict: concerns".',
    section('Request', cap(context.request, REQUEST_LIMIT)),
    section('Plan', context.plan.length > 0 ? numbered(context.plan) : 'No plan was made.'),
    section('Files changed', changeLines(context.changes)),
    section(
      'Diff',
      context.patch.trim() ? `\`\`\`diff\n${cap(context.patch, PATCH_LIMIT)}\n\`\`\`` : 'No diff.',
    ),
    section(
      'Check results',
      context.checks.length > 0 ? context.checks.join('\n') : 'No checks ran.',
    ),
  ].join('\n\n');
}
