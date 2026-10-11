import { checkBodySchema, failingChecks, reviewBodySchema } from '@spark-outpost/contracts';
import {
  cap,
  checkFailureText,
  PATCH_LIMIT,
  REQUEST_LIMIT,
  section,
  type ChangedFile,
  type HistoryTurn,
} from '../orchestration/context.ts';
import type { Queryable } from '../persistence/db.ts';
import { gitDiffSince, headCommit } from '../projects/snapshot.ts';

export const HISTORY_TOOL_NOTE =
  'The full transcript is kept. Call the spark_chat_history tool to read earlier turns of this chat (by turn range or a search) or this summary when you need a detail it left out.';

export const CHAT_SUMMARY_HEADING = '# Compacted chat summary';

export const CHAT_SUMMARY_ROLE =
  'Earlier turns of this chat were compacted into this summary to free context. Requests, the agreed plan, open issues, the current diff and the most recent turns are kept as they were; stale tool output is dropped. Continue the conversation from here.';

export const CHAT_SUMMARY_TURNS = { count: 12, limit: 4_000 };

const CHAT_REQUESTS = 30;
const CHAT_REQUEST_LIMIT = 300;

const REVIEW_FINDINGS = 10;

export function bullets(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}

export function recentTurnsText(
  history: readonly HistoryTurn[],
  { count, limit }: { count: number; limit: number },
): string {
  const recent = history.slice(-count);
  if (recent.length === 0) return 'No earlier messages.';
  return recent
    .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${cap(turn.content, limit)}`)
    .join('\n\n');
}

export interface ChatSummaryContext {
  history: readonly HistoryTurn[];
  agreedPlan: string | null;
  changes: readonly ChangedFile[];
  patch: string;
  openIssues: readonly string[];
}

function requestsText(history: readonly HistoryTurn[]): string {
  const asked = history.filter((turn) => turn.role === 'user');
  const shown = asked.slice(-CHAT_REQUESTS).map((turn) => cap(turn.content, CHAT_REQUEST_LIMIT));
  const dropped = asked.length - shown.length;
  const lines = shown.map((request, index) => `${index + 1 + dropped}. ${request}`);
  return dropped > 0
    ? [`(${dropped} earlier requests not listed)`, ...lines].join('\n')
    : lines.join('\n');
}

export function chatSummaryPrompt(context: ChatSummaryContext): string {
  const first = context.history.find((turn) => turn.role === 'user')?.content ?? '';
  const files = context.changes.map(
    (file) => `${file.path} (+${file.additions} -${file.deletions})`,
  );
  const parts = [
    CHAT_SUMMARY_HEADING,
    CHAT_SUMMARY_ROLE,
    HISTORY_TOOL_NOTE,
    section('What the chat started with', first.trim() ? cap(first, REQUEST_LIMIT) : 'No request.'),
    section('Requests so far', requestsText(context.history) || 'None.'),
  ];
  if (context.agreedPlan) parts.push(context.agreedPlan);
  parts.push(
    section('Recent turns, verbatim', recentTurnsText(context.history, CHAT_SUMMARY_TURNS)),
  );
  if (files.length > 0) parts.push(section('Files changed', bullets(files)));
  if (context.patch.trim()) {
    parts.push(section('Current diff', `\`\`\`diff\n${cap(context.patch, PATCH_LIMIT)}\n\`\`\``));
  }
  if (context.openIssues.length > 0) {
    parts.push(section('Open issues', context.openIssues.join('\n\n')));
  }
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

export async function taskDiff(
  root: string | undefined,
): Promise<{ files: ChangedFile[]; patch: string }> {
  const none = { files: [], patch: '' };
  if (!root) return none;
  const head = await headCommit(root).catch(() => null);
  if (!head) return none;
  const diff = await gitDiffSince(root, head).catch(() => null);
  return diff ? { files: diff.stats, patch: diff.patch } : none;
}

export const SESSION_HANDOFF_HEADING = '# Handoff from the earlier session';

const SESSION_HANDOFF_EXCHANGES = 3;
const SESSION_HANDOFF_TURN_LIMIT = 2_000;

export interface SessionHandoffContext {
  reason: string;
  goal: string;
  history: readonly HistoryTurn[];
  agreedPlan: string | null;
  subtasks: readonly string[];
  changes: readonly ChangedFile[];
  openIssues: readonly string[];
  totals: string | null;
}

function lastExchanges(history: readonly HistoryTurn[]): string {
  const recent = history.slice(-SESSION_HANDOFF_EXCHANGES * 2);
  if (recent.length === 0) return 'No earlier messages.';
  return recent
    .map(
      (turn) =>
        `${turn.role === 'user' ? 'User' : 'Assistant'}: ${cap(turn.content, SESSION_HANDOFF_TURN_LIMIT)}`,
    )
    .join('\n\n');
}

export function sessionHandoffPrompt(context: SessionHandoffContext): string {
  const files = context.changes.map(
    (file) => `${file.path} (+${file.additions} -${file.deletions})`,
  );
  const parts = [
    SESSION_HANDOFF_HEADING,
    `The agent session this chat was using was replaced (${context.reason}). This is what Spark recorded from it. The edits listed are in the working tree: read the files before changing them again.`,
    HISTORY_TOOL_NOTE,
    section(
      'Goal',
      context.goal.trim() ? cap(context.goal, REQUEST_LIMIT) : 'No request recorded.',
    ),
  ];
  if (context.agreedPlan) parts.push(context.agreedPlan);
  if (context.subtasks.length > 0) parts.push(section('Open subtasks', bullets(context.subtasks)));
  parts.push(section('Files changed', files.length > 0 ? bullets(files) : 'None.'));
  parts.push(
    section(
      'Last check output',
      context.openIssues.length > 0
        ? context.openIssues.join('\n\n')
        : 'No failing checks or open review findings recorded.',
    ),
  );
  parts.push(section('Last three exchanges, verbatim', lastExchanges(context.history)));
  if (context.totals) parts.push(section('Chat totals', context.totals));
  return parts.join('\n\n');
}
