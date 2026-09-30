import { checkBodySchema, failingChecks, reviewBodySchema } from '@spark-outpost/contracts';
import { BUILDER_GIT_RULE } from '../coordinator/prompts.ts';
import type { Queryable } from '../persistence/db.ts';
import { gitDiffSince, headCommit } from '../projects/snapshot.ts';
import {
  cap,
  checkFailureText,
  INCREMENT_RULE,
  namedFiles,
  PATCH_LIMIT,
  section,
  SHIP_RULE,
  type ChangedFile,
  type HistoryTurn,
} from './context.ts';
import { agreedPlanText, checkCommands } from './member-prompts.ts';
import type { Session } from './session.ts';

export type HandoffKind = 'brief' | 'compact';

export const HANDOFF_HEADINGS = {
  brief: '# Brief from the task so far',
  compact: '# Compacted handoff',
} as const;

const ROLE_LINES: Record<HandoffKind, string> = {
  brief:
    'Role: Builder, brought in for a hard request in a long task. Another Builder’s session holds the full history; this brief is what you need from it. Make the change, then reply with what you changed.',
  compact:
    'Role: Builder, continuing this task from a compacted handoff. The earlier session was replaced by this summary: rules, decisions, open issues and the diff are kept as they were; stale tool output is dropped. Make the change, then reply with what you changed.',
};

const RULES_LINE =
  'The repository’s own instructions (AGENTS.md, CLAUDE.md and similar) are loaded into your session and still apply.';

const TURNS: Record<HandoffKind, { count: number; limit: number }> = {
  brief: { count: 6, limit: 1_500 },
  compact: { count: 12, limit: 4_000 },
};

const REQUEST_LIMIT = 8_000;
const REVIEW_FINDINGS = 10;

export interface HandoffContext {
  kind: HandoffKind;
  request: string;
  history: readonly HistoryTurn[];
  agreedPlan: string | null;
  changes: readonly ChangedFile[];
  patch: string;
  openIssues: readonly string[];
  checkCommands: readonly string[];
}

function bullets(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}

function turnsText(kind: HandoffKind, history: readonly HistoryTurn[]): string {
  const { count, limit } = TURNS[kind];
  const recent = history.slice(-count);
  if (recent.length === 0) return 'No earlier messages.';
  return recent
    .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${cap(turn.content, limit)}`)
    .join('\n\n');
}

function relevantFiles(context: HandoffContext): string[] {
  const changed = context.changes.map(
    (file) => `${file.path} (+${file.additions} -${file.deletions})`,
  );
  const named = namedFiles([context.request]).filter(
    (path) => !context.changes.some((file) => file.path === path),
  );
  return [...changed, ...named.map((path) => `${path} (named in the request)`)];
}

function acceptance(context: HandoffContext): string[] {
  const done = ['The goal above is met, and the change stays a small increment.'];
  if (context.openIssues.length > 0) done.push('The open issues below are fixed or explained.');
  for (const command of context.checkCommands) done.push(`\`${command}\` passes.`);
  return done;
}

export function handoffPrompt(context: HandoffContext): string {
  const files = relevantFiles(context);
  const parts = [
    HANDOFF_HEADINGS[context.kind],
    ROLE_LINES[context.kind],
    section('Goal', cap(context.request, REQUEST_LIMIT)),
    section('Rules', bullets([RULES_LINE, INCREMENT_RULE, SHIP_RULE, BUILDER_GIT_RULE])),
  ];
  if (context.agreedPlan) parts.push(context.agreedPlan);
  const decisions = context.kind === 'compact' ? 'Recent turns, verbatim' : 'Decisions so far';
  parts.push(section(decisions, turnsText(context.kind, context.history)));
  parts.push(section('Relevant files', files.length > 0 ? bullets(files) : 'None changed yet.'));
  parts.push(
    section(
      'Current diff',
      context.patch.trim() ? `\`\`\`diff\n${cap(context.patch, PATCH_LIMIT)}\n\`\`\`` : 'No diff.',
    ),
  );
  if (context.openIssues.length > 0) {
    parts.push(section('Open issues', context.openIssues.join('\n\n')));
  }
  parts.push(section('Acceptance', bullets(acceptance(context))));
  return parts.join('\n\n');
}

async function latestArtifact(db: Queryable, taskId: string, kind: 'check' | 'review') {
  const { rows } = await db.query<{ body: unknown }>(
    `SELECT body FROM run_artifacts WHERE task_id = $1 AND kind = $2
     ORDER BY version DESC LIMIT 1`,
    [taskId, kind],
  );
  return rows[0]?.body ?? null;
}

export async function openIssues(db: Queryable, taskId: string | null): Promise<string[]> {
  if (!taskId) return [];
  const [check, review] = await Promise.all([
    latestArtifact(db, taskId, 'check'),
    latestArtifact(db, taskId, 'review'),
  ]);
  const issues: string[] = [];
  const checks = checkBodySchema.safeParse(check);
  const failing = checks.success ? failingChecks(checks.data) : [];
  if (failing.length > 0) issues.push(`Failing checks:\n${checkFailureText(failing)}`);
  const reviewed = reviewBodySchema.safeParse(review);
  if (reviewed.success && reviewed.data.verdict === 'concerns') {
    const findings = reviewed.data.findings.slice(0, REVIEW_FINDINGS);
    issues.push(`Review findings still open:\n${bullets(findings)}`);
  }
  return issues;
}

async function taskDiff(
  root: string | undefined,
): Promise<{ files: ChangedFile[]; patch: string }> {
  const none = { files: [], patch: '' };
  if (!root) return none;
  const head = await headCommit(root).catch(() => null);
  if (!head) return none;
  const diff = await gitDiffSince(root, head).catch(() => null);
  return diff ? { files: diff.stats, patch: diff.patch } : none;
}

export async function loadHandoff(s: Session, kind: HandoffKind): Promise<string> {
  const [agreedPlan, diff, issues] = await Promise.all([
    agreedPlanText(s),
    taskDiff(s.input.projectRoots[0]),
    openIssues(s.deps.db, s.taskId),
  ]);
  return handoffPrompt({
    kind,
    request: s.input.userRequest,
    history: s.input.history,
    agreedPlan,
    changes: diff.files,
    patch: diff.patch,
    openIssues: issues,
    checkCommands: checkCommands(s),
  });
}

export function handbackNote(label: string, history: readonly HistoryTurn[]): string {
  const reply = history.findLast((turn) => turn.role === 'assistant')?.content ?? '';
  return [
    `While your session was idle, ${label} handled the last request in this task from a brief, in its own session. Its edits are in the tree; read the files before changing them again.`,
    reply.trim() ? section('Its reply', cap(reply, 3_000)) : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}
