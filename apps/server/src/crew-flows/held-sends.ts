import {
  HELD_SEND_SUMMARY_MAX,
  heldSendKindSchema,
  type HeldSend,
  type HeldSendKind,
} from '@spark-outpost/contracts';
import { normalizeCommand, splitSimpleCommands } from '../approvals/commands.ts';
import type { ApprovalRequest } from '../approvals/decide.ts';
import { egressOf, egressTarget } from '../approvals/egress.ts';
import type { FileLister } from '../approvals/file-lister.ts';
import { hostingCommands, isGitPush, publishesCode } from '../approvals/git-commands.ts';
import type { OwnRepo } from '../approvals/own-repo.ts';
import { shortCommand } from '../approvals/policy-blocked.ts';
import { redactText, redactValue, storableText } from '../audit/redact.ts';
import type { Queryable } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';

export const HELD_REASON =
  'This is a test run, so nothing is sent off this computer. It was not sent; it is listed for the user as "would have been sent"';
export const HELD_TOOL_MESSAGE =
  'Held: this is a test run, so this was not done. Spark listed it for the user as "would have been sent". Don’t try again or find another way; say in your reply what you would have done.';

export interface Held {
  kind: HeldSendKind;
  summary: string;
}

function oneLine(text: string): string {
  const flat = redactText(storableText(text)).replace(/\s+/g, ' ').trim();
  return flat.length > HELD_SEND_SUMMARY_MAX
    ? `${flat.slice(0, HELD_SEND_SUMMARY_MAX - 1).trimEnd()}…`
    : flat;
}

function opensPullRequest(command: string): boolean {
  return hostingCommands(command).some(
    (program) => program[1] === 'pr' && (program[2] === 'create' || program[2] === 'new'),
  );
}

function onlyReadsHosting(command: string): boolean {
  const hosting = hostingCommands(command).length;
  return hosting > 0 && hosting === splitSimpleCommands(normalizeCommand(command)).length;
}

export function heldCommand(
  request: ApprovalRequest,
  files: FileLister,
  own: OwnRepo | null,
): Held | null {
  const command = request.kind === 'execute' ? request.command : null;
  if (!command) return null;
  const short = shortCommand(command);
  if (opensPullRequest(command)) return { kind: 'pull_request', summary: oneLine(short) };
  if (isGitPush(command)) return { kind: 'push', summary: oneLine(short) };
  if (publishesCode(command)) return { kind: 'command', summary: oneLine(short) };
  if (onlyReadsHosting(command)) return null;
  const egress = egressOf(request, files, own);
  if (!egress) return null;
  return { kind: 'command', summary: oneLine(`${short}, ${egressTarget(egress)}`) };
}

const TOOL_KINDS: readonly [RegExp, HeldSendKind][] = [
  [/^spark_push$/, 'push'],
  [/^spark_pull_request$|^spark_pr/, 'pull_request'],
  [/ticket|jira|servicenow/, 'ticket'],
  [/confluence/, 'confluence'],
  [/slack/, 'slack'],
  [/calendar/, 'calendar'],
  [/^spark_browser/, 'browser'],
  [/^spark_mac/, 'mac'],
];

function argsLine(args: unknown): string {
  if (args === null || typeof args !== 'object') return '';
  const parts = Object.entries(redactValue(args) as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key} ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  return parts.join(', ');
}

export function heldTool(name: string, args: unknown): Held {
  const kind = TOOL_KINDS.find(([pattern]) => pattern.test(name))?.[1] ?? 'spark_action';
  const said = argsLine(args);
  return { kind, summary: oneLine(said ? `${name}: ${said}` : name) };
}

export async function recordHeldSend(db: Queryable, runId: string, held: Held): Promise<void> {
  await db.query(
    'INSERT INTO workflow_held_sends (id, run_id, kind, summary) VALUES ($1, $2, $3, $4)',
    [newId(), runId, held.kind, held.summary],
  );
}

interface HeldRow {
  id: string;
  step_id: string | null;
  kind: string;
  summary: string;
  created_at: Date;
}

export async function heldSendsOf(db: Queryable, workflowRunId: string): Promise<HeldSend[]> {
  const { rows } = await db.query<HeldRow>(
    `SELECT h.id, s.step_id, h.kind, h.summary, h.created_at
     FROM workflow_held_sends h
     JOIN workflow_run_steps s ON s.run_id = h.run_id
     WHERE s.workflow_run_id = $1
     ORDER BY h.created_at, h.id`,
    [workflowRunId],
  );
  return rows.map((row) => ({
    id: row.id,
    stepId: row.step_id,
    kind: heldSendKindSchema.catch('spark_action').parse(row.kind),
    summary: row.summary,
    at: row.created_at.toISOString(),
  }));
}
