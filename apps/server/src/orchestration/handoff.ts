import { BUILDER_GIT_RULE } from '../coordinator/prompts.ts';
import {
  bullets,
  CHAT_SUMMARY_HEADING,
  CHAT_SUMMARY_ROLE,
  CHAT_SUMMARY_TURNS,
  openIssues,
  recentTurnsText,
  taskDiff,
} from '../workflow/session-brief.ts';
import {
  cap,
  INCREMENT_RULE,
  namedFiles,
  PATCH_LIMIT,
  REQUEST_LIMIT,
  section,
  SHIP_RULE,
  type ChangedFile,
  type HistoryTurn,
} from './context.ts';
import { agreedPlanText, checkCommands } from './member-prompts.ts';
import type { Session } from './session.ts';

export type HandoffKind = 'brief' | 'compact' | 'chat';

export const HANDOFF_HEADINGS = {
  brief: '# Brief from the task so far',
  compact: '# Compacted handoff',
  chat: CHAT_SUMMARY_HEADING,
} as const;

const ROLE_LINES: Record<HandoffKind, string> = {
  brief:
    'Role: Builder, brought in for a hard request in a long task. Another Builder’s session holds the full history; this brief is what you need from it. Make the change, then reply with what you changed.',
  compact:
    'Role: Builder, continuing this task from a compacted handoff. The earlier session was replaced by this summary: rules, decisions, open issues and the diff are kept as they were; stale tool output is dropped. Make the change, then reply with what you changed.',
  chat: CHAT_SUMMARY_ROLE,
};

const RULES_LINE =
  'The repository’s own instructions (AGENTS.md, CLAUDE.md and similar) are loaded into your session and still apply.';

const TURNS: Record<HandoffKind, { count: number; limit: number }> = {
  brief: { count: 6, limit: 1_500 },
  compact: { count: 12, limit: 4_000 },
  chat: CHAT_SUMMARY_TURNS,
};

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

function turnsText(kind: HandoffKind, history: readonly HistoryTurn[]): string {
  return recentTurnsText(history, TURNS[kind]);
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
