import type { TaskPiece } from '@spark-outpost/contracts';
import { COORD_MAX_PIECES } from '../advisor/policy.ts';
import { pieceKey } from './builder-count.ts';
import type { PlanStep } from './plan-coverage.ts';
import { noCheckLabel } from './scoped-checks.ts';

export const PIECES_FENCE = 'pieces';
export const PIECE_HEADING = '## Your piece';
export const COORDINATOR_ROLE_LINE =
  'Role: Coordinator. Plan how Builders will build this request, one piece each. Change no files.';
export const BUILDER_GIT_RULE =
  'Use `git diff` and `git show HEAD:<path>` for baselines; never change the index, the branch or the stash.';
const SCOUT_NOTES_LIMIT = 4_000;
const REQUEST_LIMIT = 8_000;

export interface CoordinatorContext {
  request: string;
  agreedPlan: string | null;
  likelyFiles: readonly { path: string; lines: number | null; leads?: readonly string[] }[];
  planFiles: readonly string[];
  checks: readonly string[];
  budgetTokens: number;
  groups?: readonly (readonly PlanStep[])[] | null;
}

function clip(text: string, limit: number): string {
  const trimmed = text.trim();
  return trimmed.length > limit
    ? `${trimmed.slice(0, limit)}\n[cut at ${limit} characters]`
    : trimmed;
}

function bullets(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}

const EXAMPLE = `\`\`\`${PIECES_FENCE}
{
  "pieces": [
    {
      "key": "P1",
      "title": "Tags table and repository",
      "goal": "Store tags per project",
      "owns": ["apps/server/src/persistence/tags.ts"],
      "reads": ["apps/server/src/persistence/projects.ts"],
      "dependsOn": [],
      "contract": "listTags(db, projectId): Promise<string[]>",
      "acceptance": ["Tags are lower case and deduplicated"],
      "checks": ["pnpm vitest run apps/server/src/persistence/tags.test.ts"],
      "size": "M"
    }
  ],
  "integration": "Wire the tags route into api/app.ts after P2 lands"
}
\`\`\``;

function groupsSection(groups: readonly (readonly PlanStep[])[]): string {
  const keys = groups.map((_, index) => pieceKey(index));
  const lines = groups.map(
    (steps, index) => `${keys[index]}: ${steps.map((step) => step.text).join('; ')}`,
  );
  return `## Builders\nSpark chose ${groups.length} Builders for the agreed plan. Write exactly ${groups.length} pieces that build, with the keys ${keys.join(', ')}, one per group below, and cover every plan item of its group in that piece. Research pieces may use other keys.\n${bullets(lines)}`;
}

export function coordinatorPrompt(context: CoordinatorContext): string {
  const files = context.likelyFiles.map((file) => {
    const size = file.lines === null ? file.path : `${file.path} (${file.lines} lines)`;
    return file.leads?.length ? `${size}: ${file.leads.join(', ')}` : size;
  });
  return [
    COORDINATOR_ROLE_LINE,
    `## Request\n${clip(context.request, REQUEST_LIMIT)}`,
    ...(context.agreedPlan ? [context.agreedPlan] : []),
    ...(context.planFiles.length > 0
      ? [
          `## Files the agreed plan names\nEvery plan step that names one of these is covered by the piece that owns or reads it:\n${bullets(context.planFiles)}`,
        ]
      : []),
    ...(files.length > 0
      ? [
          `## Files the code scan ranked likely\nA ranking hint, not a limit. Declarations are name@startLine-endLine.\n${bullets(files)}`,
        ]
      : []),
    ...(context.groups ? [groupsSection(context.groups)] : []),
    ...(context.checks.length > 0 ? [`## Project checks\n${bullets(context.checks)}`] : []),
    `## Reply\nReply with one fenced \`${PIECES_FENCE}\` block and nothing else, in this message. Don't write a plan file or ask to leave plan mode: this reply is the plan.\n\n${EXAMPLE}`,
    `## Rules\n${bullets([
      `Split the work into pieces one Builder can finish, each under about ${Math.round(context.budgetTokens / 1000)}K tokens of context. Use one piece when the request fits one Builder. At most ${COORD_MAX_PIECES} pieces.`,
      'Every piece owns the files it changes, as paths relative to the project root (globs allowed). Two pieces may own the same file only when one depends on the other.',
      'dependsOn lists the keys of pieces that must land first. A piece that reads a file another piece owns depends on that piece.',
      'contract names the interfaces the piece gives other pieces (names and signatures), not how to build them. acceptance lists observable results.',
      "checks are scoped commands narrowed to the piece's files, such as one test file. Never the whole project's checks, installs or formatters: the coordinator runs the full checks after integration.",
      'A piece that only changes docs or text files (README.md, *.md, *.txt) needs no check: leave its checks empty.',
      'Mark a piece that only reads and reports with "research": true; it owns no files.',
      'integration says what glue is left once every piece has landed, or null.',
      'Every step of the agreed plan needs a piece: a step is covered when a piece owns or reads a file the step names, or when its title, goal or acceptance says what the step does.',
    ])}`,
  ].join('\n\n');
}

export function repairPrompt(prompt: string, errors: readonly string[]): string {
  return `${prompt}\n\n## Problems with your last pieces block\n${bullets(errors.slice(0, 20))}\n\nReply with a corrected \`${PIECES_FENCE}\` block only.`;
}

const FENCED = /```([\w-]*)\s*\n([\s\S]*?)```/g;

export function piecesBlockText(text: string): unknown {
  const blocks = [...text.matchAll(FENCED)];
  const tagged = blocks.find((block) => block[1] === PIECES_FENCE) ?? blocks.at(-1);
  const body = tagged?.[2] ?? text;
  try {
    return JSON.parse(body.trim());
  } catch {
    return null;
  }
}

export interface LandedPiece {
  key: string;
  title: string;
  files: readonly string[];
}

export interface PieceBrief {
  piece: TaskPiece;
  owner: string;
  others: readonly { key: string; name: string | null; owns: readonly string[] }[];
  landed: readonly LandedPiece[];
  scoutNotes: string | null;
}

function landedLines(landed: readonly LandedPiece[]): string {
  if (landed.length === 0) return 'Nothing yet; this is the first piece.';
  return landed
    .map((piece) => `- ${piece.key} · ${piece.title}: ${piece.files.join(', ') || 'no files'}`)
    .join('\n');
}

export function pieceSection(brief: PieceBrief): string {
  const { piece } = brief;
  const parts = [
    `${PIECE_HEADING}: ${piece.key} · ${piece.title}`,
    `Goal: ${piece.goal}`,
    piece.research
      ? 'This piece only reads: change no files, and reply with what the Builders after you need to know.'
      : `You (${brief.owner}) own these files; change only them, and say in your reply if another file needs a change:\n${bullets(piece.owns)}`,
  ];
  if (piece.reads.length > 0) parts.push(`Read first:\n${bullets(piece.reads)}`);
  if (piece.contract) parts.push(`Contract:\n${piece.contract}`);
  if (piece.acceptance.length > 0) parts.push(`Acceptance:\n${bullets(piece.acceptance)}`);
  if (piece.checks.length > 0) {
    parts.push(`Scoped checks (the harness runs them after your turn):\n${bullets(piece.checks)}`);
  } else if (!piece.research && noCheckLabel(piece.owns) !== 'none') {
    parts.push(`Scoped checks: ${noCheckLabel(piece.owns)}.`);
  }
  const owners = brief.others.filter((other) => other.owns.length > 0);
  if (owners.length > 0) {
    parts.push(
      `Other pieces own:\n${bullets(owners.map((other) => `${other.name ?? other.key}: ${other.owns.join(', ')}`))}`,
    );
  }
  parts.push(`## Landed so far\n${landedLines(brief.landed)}`);
  if (brief.scoutNotes)
    parts.push(`## Notes from Scouts\n${clip(brief.scoutNotes, SCOUT_NOTES_LIMIT)}`);
  parts.push(
    `## Rules for pieces\n${bullets([
      BUILDER_GIT_RULE,
      "Don't run the project's full checks, formatters over the repo, or migrations against a shared database: the coordinator runs the full checks after integration.",
      'Run a package install when the piece needs one or the request asks for it.',
      'Stop after each acceptance item that passes its scoped check, and reply with what you changed.',
    ])}`,
  );
  return parts.join('\n\n');
}

export function handoffSection(files: readonly string[], lastCheck: string | null): string {
  return [
    '## Handoff',
    'You take over this piece from a Builder whose context was nearly full. Its edits are in the tree.',
    `Files changed so far:\n${files.length > 0 ? bullets(files) : '- none'}`,
    ...(lastCheck ? [`Last scoped check output:\n${lastCheck}`] : []),
  ].join('\n\n');
}

export const INTEGRATOR_ROLE_LINE =
  'Role: Integrator. Every piece has landed. Make the glue below work across the pieces, then reply with what you changed.';

export function integratorSection(integration: string, landed: readonly LandedPiece[]): string {
  return [
    INTEGRATOR_ROLE_LINE,
    `## Integration\n${integration}`,
    `## Pieces that landed\n${landedLines(landed)}`,
    BUILDER_GIT_RULE,
  ].join('\n\n');
}
