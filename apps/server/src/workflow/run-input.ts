import {
  UNSET_RUN_LEVEL,
  type AgentRole,
  type ConfigValues,
  type Attachment,
  type InvolvementLevel,
  type ModelSwitch,
  type RunMode,
  type StartAs,
} from '@spark-outpost/contracts';
import {
  attachmentFilesForMessages,
  attachmentsForMessages,
  type AttachmentFile,
} from '../persistence/attachments.ts';
import { usableDefault } from '../model-cards/cards.ts';
import type { Db } from '../persistence/db.ts';
import { latestSparkSeed } from '../persistence/compactions.ts';
import type { AgentSettings, ConversationTurn, TurnAttachment } from '../providers/provider.ts';
import { historyLabel, requestAuthor } from '../outposts/request-prompt.ts';
import type { RunIdentity } from './run-events.ts';
import { withInterruptionNote } from './continue-note.ts';
import { usableSettings } from './model-guard.ts';

export interface RunInput {
  identity: RunIdentity;
  workspaceId: string;
  prompt: string;
  attachments: TurnAttachment[];
  provider: string;
  history: ConversationTurn[];
  settings: AgentSettings;
  projectRoots: string[];
  chatFolder?: boolean;
  mode: RunMode | null;
  level: InvolvementLevel;
  agentMode: string | null;
  parentRunId: string | null;
  userRequest: string;
  role: AgentRole | null;
  askTitle: boolean;
  chatTitle?: string | null;
  previousMessageId?: string | null;
  resumeKey?: string | null;
  followUp?: string | null;
  preamble?: string | null;
  startAs?: StartAs | null;
  planning?: boolean;
  plansFirst?: boolean;
  projectMove?: ProjectMove | null;
  chatWorktree?: boolean;
  assistant?: boolean;
  seed?: ChatSeed | null;
  continuesRunId?: string | null;
  modelSwitch?: ModelSwitch | null;
  followUpRound?: boolean;
  sparkRuleRetry?: boolean;
  assistantSent?: boolean;
  workflowStep?: boolean;
  outpostRequest?: OutpostRequest | null;
  turnTimes?: TurnTimes | null;
  agentCycle?: boolean;
}

export interface OutpostRequest {
  postId: string;
  outpostName: string | null;
  fromUser: boolean;
  fromHandle?: string | null;
  fromTitle?: string | null;
  userStarted?: boolean;
  agentStarted?: boolean;
  wrapUp?: boolean;
}

export interface TurnTimes {
  startedAt: string;
  previousStartedAt: string | null;
}

export interface ChatSeed {
  text: string;
  historyFrom: number;
}

export interface ProjectMove {
  from: string;
  to: string;
}

interface OutpostRow {
  outpost_run: boolean | null;
  outpost_from_user: boolean | null;
  outpost_from_handle: string | null;
  outpost_from_title: string | null;
  outpost_user_started: boolean | null;
  outpost_agent_started: boolean | null;
  outpost_wrap_up: boolean | null;
  outpost_name: string | null;
}

interface RunRow extends OutpostRow {
  user_message_id: string;
  agent_cycle: boolean;
  conversation_id: string;
  workspace_id: string;
  run_model: string | null;
  run_effort: string | null;
  provider: string;
  content: string;
  method: 'cli' | 'api_key' | null;
  model: string | null;
  effort: string | null;
  models: { id: string; label: string }[] | null;
  project_roots: string[];
  run_mode: RunMode | null;
  start_as: StartAs | null;
  run_level: InvolvementLevel | null;
  follow_up_round: boolean | null;
  spark_rule_retry: boolean | null;
  assistant_sent: boolean | null;
  workflow_step: boolean | null;
  started_at: Date;
  previous_started_at: Date | null;
  agent_mode: string | null;
  config_values: ConfigValues | null;
  parent_run_id: string | null;
  run_prompt: string | null;
  run_role: AgentRole | null;
  resume_key: string | null;
  follow_up: string | null;
  in_chat_worktree: boolean;
  title_source: string;
  chat_title: string | null;
  assistant: boolean;
  assistant_history_from: Date | null;
  continues_run_id: string | null;
}

interface HistoryRow extends OutpostRow {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: Date;
}

const RESENT_ATTACHMENT_TURNS = 3;

const toTurnAttachment = ({ name, mediaType, kind, data }: AttachmentFile): TurnAttachment => ({
  name,
  mediaType,
  kind,
  data,
});

function asStored(row: HistoryRow): string {
  const request = row.role === 'user' ? outpostRequestOf(row, row.id) : null;
  if (!request) return row.content;
  return historyLabel({
    postId: request.postId,
    outpostName: request.outpostName,
    author: requestAuthor(request),
    body: row.content,
  });
}

function withEarlierMentions(content: string, attachments: readonly Attachment[]): string {
  if (attachments.length === 0) return content;
  const mentions = attachments.map((attachment) => `[Earlier attachment: ${attachment.name}]`);
  return [content, ...mentions].join('\n');
}

function resentMessageIds(rows: readonly HistoryRow[]): Set<string> {
  return new Set(
    rows
      .filter((row) => row.role === 'user')
      .slice(-RESENT_ATTACHMENT_TURNS)
      .map((row) => row.id),
  );
}

async function loadHistory(
  db: Db,
  rows: readonly HistoryRow[],
  currentMessageId: string,
): Promise<{ history: ConversationTurn[]; attachments: TurnAttachment[] }> {
  const resent = resentMessageIds(rows);
  const earlierIds = rows.filter((row) => !resent.has(row.id)).map((row) => row.id);
  const [files, earlier] = await Promise.all([
    attachmentFilesForMessages(db, [currentMessageId, ...resent]),
    attachmentsForMessages(db, earlierIds),
  ]);
  const history = rows.map((row): ConversationTurn => {
    const resentFiles = resent.has(row.id) ? files.get(row.id) : undefined;
    if (resentFiles) {
      return {
        role: row.role,
        content: asStored(row),
        attachments: resentFiles.map(toTurnAttachment),
      };
    }
    return {
      role: row.role,
      content: withEarlierMentions(asStored(row), earlier.get(row.id) ?? []),
    };
  });
  return { history, attachments: (files.get(currentMessageId) ?? []).map(toTurnAttachment) };
}

export async function loadRunInput(db: Db, runId: string): Promise<RunInput> {
  const { rows } = await db.query<RunRow>(
    `SELECT r.user_message_id, r.conversation_id, c.workspace_id, r.provider,
            COALESCE(m.content, '') AS content, r.source = 'agent_cycle' AS agent_cycle,
            COALESCE((SELECT p.source FROM runs p WHERE p.id = r.parent_run_id), r.source)
              = 'pr_follow_up' AS follow_up_round,
            COALESCE((SELECT p.source FROM runs p WHERE p.id = r.parent_run_id), r.source)
              = 'spark_rule' AS spark_rule_retry,
            (COALESCE((SELECT p.source FROM runs p WHERE p.id = r.parent_run_id), r.source)
              IN ('assistant', 'workflow') OR COALESCE((r.route->'spark') ? 'step', false))
              AS assistant_sent,
            COALESCE((r.route->'spark') ? 'step', false) AS workflow_step,
            COALESCE((SELECT p.source FROM runs p WHERE p.id = r.parent_run_id), r.source)
              = 'outpost' AS outpost_run,
            op.from_user AS outpost_from_user, o.name AS outpost_name,
            op.from_handle AS outpost_from_handle, op.user_started AS outpost_user_started,
            op.agent_started AS outpost_agent_started,
            EXISTS (SELECT 1 FROM outpost_drafts od WHERE od.id = op.id) AS outpost_wrap_up,
            (SELECT fc.title FROM conversations fc WHERE fc.id = op.from_conversation_id)
              AS outpost_from_title,
            r.created_at AS started_at,
            (SELECT max(p.created_at) FROM runs p
             WHERE p.conversation_id = r.conversation_id AND p.parent_run_id IS NULL
               AND p.id <> r.id AND p.created_at <= r.created_at) AS previous_started_at,
            r.model AS run_model, r.effort AS run_effort,
            r.mode AS run_mode, r.start_as, r.level AS run_level, r.agent_mode, r.config_values,
            r.parent_run_id, r.prompt AS run_prompt, r.role AS run_role,
            r.route->>'resumeKey' AS resume_key, r.route->>'followUp' AS follow_up,
            c.title_source, c.title AS chat_title,
            COALESCE(r.continues_run_id, (
              SELECT p.continues_run_id FROM runs p WHERE p.id = r.parent_run_id
            )) AS continues_run_id,
            EXISTS (
              SELECT 1 FROM profiles pf
              WHERE pf.workspace_id = c.workspace_id AND pf.assistant_conversation_id = c.id
            ) AS assistant,
            (SELECT pf.assistant_history_from FROM profiles pf
             WHERE pf.workspace_id = c.workspace_id AND pf.assistant_conversation_id = c.id
            ) AS assistant_history_from,
            pc.method, pc.model, pc.effort, pc.models,
            ARRAY(
              SELECT COALESCE(cw.path, p.root_path) FROM conversation_projects cp
              JOIN projects p ON p.id = cp.project_id
              LEFT JOIN chat_worktrees cw ON cw.conversation_id = cp.conversation_id
               AND cw.project_id = cp.project_id AND cw.removed_at IS NULL AND NOT cw.in_place
              WHERE cp.conversation_id = c.id ORDER BY cp.position, cp.created_at
            ) AS project_roots,
            EXISTS (
              SELECT 1 FROM chat_worktrees cw
              WHERE cw.conversation_id = c.id AND cw.removed_at IS NULL AND NOT cw.in_place
                AND cw.project_id = (
                  SELECT cp.project_id FROM conversation_projects cp WHERE cp.conversation_id = c.id
                  ORDER BY cp.position, cp.created_at LIMIT 1)
            ) AS in_chat_worktree
     FROM runs r
     LEFT JOIN messages m ON m.id = r.user_message_id
     JOIN conversations c ON c.id = r.conversation_id
     LEFT JOIN outpost_posts op ON op.id = r.user_message_id
     LEFT JOIN outposts o ON o.id = op.outpost_id
     LEFT JOIN provider_connections pc
       ON pc.workspace_id = c.workspace_id AND pc.provider = r.provider
      AND pc.disconnected_at IS NULL
     WHERE r.id = $1`,
    [runId],
  );
  const row = rows[0];
  if (!row) throw new Error(`Run ${runId} was not found.`);
  if (row.parent_run_id) return withUsableModel(db, childInput(runId, row));
  if (row.agent_cycle) return withUsableModel(db, agentCycleInput(runId, row));
  const history = await db.query<HistoryRow>(
    `SELECT m.id, m.role, m.content, m.created_at,
            EXISTS (
              SELECT 1 FROM runs hr
              WHERE hr.user_message_id = m.id AND hr.parent_run_id IS NULL
                AND hr.source = 'outpost'
            ) AS outpost_run,
            op.from_user AS outpost_from_user, o.name AS outpost_name,
            op.from_handle AS outpost_from_handle, op.user_started AS outpost_user_started,
            op.agent_started AS outpost_agent_started,
            EXISTS (SELECT 1 FROM outpost_drafts od WHERE od.id = op.id) AS outpost_wrap_up,
            (SELECT fc.title FROM conversations fc WHERE fc.id = op.from_conversation_id)
              AS outpost_from_title
     FROM messages m
     LEFT JOIN outpost_posts op ON op.id = m.id
     LEFT JOIN outposts o ON o.id = op.outpost_id
     WHERE m.conversation_id = $1
       AND m.created_at < (SELECT created_at FROM messages WHERE id = $2)
     ORDER BY m.created_at, m.id`,
    [row.conversation_id, row.user_message_id],
  );
  const turns = await loadHistory(
    db,
    since(history.rows, row.assistant_history_from),
    row.user_message_id,
  );
  const seed = row.assistant_history_from
    ? null
    : await chatSeed(db, row.conversation_id, history.rows);
  const input: RunInput = {
    identity: { runId, threadId: row.conversation_id },
    workspaceId: row.workspace_id,
    prompt: row.content,
    attachments: turns.attachments,
    provider: row.provider,
    history: turns.history,
    settings: settingsOf(row),
    projectRoots: row.project_roots,
    mode: row.run_mode,
    level: row.run_level ?? UNSET_RUN_LEVEL,
    agentMode: row.agent_mode,
    parentRunId: null,
    userRequest: row.content,
    followUpRound: row.follow_up_round === true,
    sparkRuleRetry: row.spark_rule_retry === true,
    assistantSent: row.assistant_sent === true,
    outpostRequest: outpostRequestOf(row, row.user_message_id),
    turnTimes: {
      startedAt: row.started_at.toISOString(),
      previousStartedAt: row.previous_started_at?.toISOString() ?? null,
    },
    role: row.run_role,
    askTitle: row.title_source !== 'user',
    chatTitle: row.chat_title,
    assistant: row.assistant,
    previousMessageId: history.rows.at(-1)?.id ?? null,
    startAs: row.start_as,
    chatWorktree: row.in_chat_worktree,
    seed,
    continuesRunId: row.continues_run_id,
  };
  const usable = await withUsableModel(db, input);
  return row.continues_run_id ? withInterruptionNote(db, usable, row.continues_run_id) : usable;
}

function since(rows: HistoryRow[], from: Date | null): HistoryRow[] {
  return from ? rows.filter((row) => row.created_at > from) : rows;
}

async function withUsableModel(db: Db, input: RunInput): Promise<RunInput> {
  const { settings, change } = await usableSettings(
    db,
    input.workspaceId,
    input.provider,
    input.settings,
  );
  return change ? { ...input, settings, modelSwitch: change } : input;
}

async function chatSeed(
  db: Db,
  conversationId: string,
  rows: readonly HistoryRow[],
): Promise<ChatSeed | null> {
  const stored = await latestSparkSeed(db, conversationId);
  if (!stored) return null;
  const covered = stored.lastMessageId
    ? rows.findIndex((row) => row.id === stored.lastMessageId)
    : -1;
  return { text: stored.summary, historyFrom: covered + 1 };
}

function outpostRequestOf(row: OutpostRow, postId: string): OutpostRequest | null {
  if (row.outpost_run !== true) return null;
  return {
    postId,
    outpostName: row.outpost_name,
    fromUser: row.outpost_from_user === true,
    fromHandle: row.outpost_from_handle,
    fromTitle: row.outpost_from_title,
    userStarted: row.outpost_user_started === true,
    agentStarted: row.outpost_agent_started === true,
    wrapUp: row.outpost_wrap_up === true,
  };
}

function settingsOf(row: RunRow): AgentSettings {
  const model = row.run_model ?? usableDefault(row.provider, row.model);
  return {
    method: row.method,
    model,
    modelLabel: row.models?.find((option) => option.id === model)?.label ?? null,
    effort: row.run_effort ?? row.effort,
    mode: row.agent_mode,
    options: row.config_values ?? {},
  };
}

function agentCycleInput(runId: string, row: RunRow): RunInput {
  return {
    identity: { runId, threadId: row.conversation_id },
    workspaceId: row.workspace_id,
    prompt: '',
    attachments: [],
    provider: row.provider,
    history: [],
    settings: settingsOf(row),
    projectRoots: row.project_roots,
    mode: row.run_mode,
    level: row.run_level ?? UNSET_RUN_LEVEL,
    agentMode: row.agent_mode,
    parentRunId: null,
    userRequest: '',
    followUpRound: false,
    outpostRequest: null,
    role: null,
    askTitle: false,
    assistant: row.assistant,
    previousMessageId: null,
    chatWorktree: row.in_chat_worktree,
    agentCycle: true,
  };
}

function childInput(runId: string, row: RunRow): RunInput {
  return {
    identity: {
      runId,
      threadId: row.conversation_id,
      ...(row.parent_run_id ? { parentRunId: row.parent_run_id } : {}),
    },
    workspaceId: row.workspace_id,
    prompt: row.run_prompt ?? row.content,
    attachments: [],
    provider: row.provider,
    history: [],
    settings: settingsOf(row),
    projectRoots: row.project_roots,
    mode: row.run_mode,
    level: row.run_level ?? UNSET_RUN_LEVEL,
    agentMode: row.agent_mode,
    parentRunId: row.parent_run_id,
    userRequest: row.content,
    followUpRound: row.follow_up_round === true,
    sparkRuleRetry: row.spark_rule_retry === true,
    assistantSent: row.assistant_sent === true,
    outpostRequest: outpostRequestOf(row, row.user_message_id),
    workflowStep: row.workflow_step === true,
    role: row.run_role,
    askTitle: false,
    previousMessageId: null,
    resumeKey: row.resume_key,
    followUp: row.follow_up,
    chatWorktree: row.in_chat_worktree,
    continuesRunId: row.continues_run_id,
  };
}
