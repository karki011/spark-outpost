import {
  DEFAULT_INVOLVEMENT_LEVEL,
  type AgentRole,
  type Attachment,
  type InvolvementLevel,
  type RunMode,
} from '@spark-outpost/contracts';
import {
  attachmentFilesForMessages,
  attachmentsForMessages,
  type AttachmentFile,
} from '../persistence/attachments.ts';
import type { Db } from '../persistence/db.ts';
import type { AgentSettings, ConversationTurn, TurnAttachment } from '../providers/provider.ts';
import type { RunIdentity } from './run-events.ts';

export interface RunInput {
  identity: RunIdentity;
  workspaceId: string;
  prompt: string;
  attachments: TurnAttachment[];
  provider: string;
  history: ConversationTurn[];
  settings: AgentSettings;
  projectRoots: string[];
  mode: RunMode | null;
  level: InvolvementLevel;
  parentRunId: string | null;
  userRequest: string;
  role: AgentRole | null;
  copyOf: string | null;
  askTitle: boolean;
  previousMessageId?: string | null;
  resumeKey?: string | null;
  followUp?: string | null;
}

interface RunRow {
  user_message_id: string;
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
  run_level: InvolvementLevel | null;
  parent_run_id: string | null;
  run_prompt: string | null;
  run_role: AgentRole | null;
  run_name: string | null;
  resume_key: string | null;
  follow_up: string | null;
  worktree_path: string | null;
  title_source: string;
}

interface HistoryRow {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export const RESENT_ATTACHMENT_TURNS = 3;

const toTurnAttachment = ({ name, mediaType, kind, data }: AttachmentFile): TurnAttachment => ({
  name,
  mediaType,
  kind,
  data,
});

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
        content: row.content,
        attachments: resentFiles.map(toTurnAttachment),
      };
    }
    return { role: row.role, content: withEarlierMentions(row.content, earlier.get(row.id) ?? []) };
  });
  return { history, attachments: (files.get(currentMessageId) ?? []).map(toTurnAttachment) };
}

export async function loadRunInput(db: Db, runId: string): Promise<RunInput> {
  const { rows } = await db.query<RunRow>(
    `SELECT r.user_message_id, r.conversation_id, c.workspace_id, r.provider, m.content,
            r.model AS run_model, r.effort AS run_effort,
            r.mode AS run_mode, r.level AS run_level,
            r.parent_run_id, r.prompt AS run_prompt, r.role AS run_role,
            r.route->>'name' AS run_name,
            r.route->>'resumeKey' AS resume_key, r.route->>'followUp' AS follow_up,
            (SELECT w.path FROM run_worktrees w
             WHERE w.run_id = COALESCE((r.route->>'worktreeRun')::uuid, r.id)) AS worktree_path,
            c.title_source,
            pc.method, pc.model, pc.effort, pc.models,
            ARRAY(
              SELECT p.root_path FROM conversation_projects cp
              JOIN projects p ON p.id = cp.project_id
              WHERE cp.conversation_id = c.id ORDER BY cp.position, cp.created_at
            ) AS project_roots
     FROM runs r
     JOIN messages m ON m.id = r.user_message_id
     JOIN conversations c ON c.id = r.conversation_id
     LEFT JOIN provider_connections pc
       ON pc.workspace_id = c.workspace_id AND pc.provider = r.provider
      AND pc.disconnected_at IS NULL
     WHERE r.id = $1`,
    [runId],
  );
  const row = rows[0];
  if (!row) throw new Error(`Run ${runId} was not found.`);
  if (row.parent_run_id) return childInput(runId, row);
  const history = await db.query<HistoryRow>(
    `SELECT id, role, content FROM messages
     WHERE conversation_id = $1
       AND created_at < (SELECT created_at FROM messages WHERE id = $2)
     ORDER BY created_at, id`,
    [row.conversation_id, row.user_message_id],
  );
  const turns = await loadHistory(db, history.rows, row.user_message_id);
  return {
    identity: { runId, threadId: row.conversation_id },
    workspaceId: row.workspace_id,
    prompt: row.content,
    attachments: turns.attachments,
    provider: row.provider,
    history: turns.history,
    settings: settingsOf(row),
    projectRoots: row.project_roots,
    mode: row.run_mode,
    level: row.run_level ?? DEFAULT_INVOLVEMENT_LEVEL,
    parentRunId: null,
    userRequest: row.content,
    role: row.run_role,
    copyOf: null,
    askTitle: row.title_source !== 'user',
    previousMessageId: history.rows.at(-1)?.id ?? null,
  };
}

function settingsOf(row: RunRow): AgentSettings {
  const model = row.run_model ?? row.model;
  return {
    method: row.method,
    model,
    modelLabel: row.models?.find((option) => option.id === model)?.label ?? null,
    effort: row.run_effort ?? row.effort,
  };
}

function childInput(runId: string, row: RunRow): RunInput {
  return {
    identity: { runId, threadId: row.conversation_id },
    workspaceId: row.workspace_id,
    prompt: row.run_prompt ?? row.content,
    attachments: [],
    provider: row.provider,
    history: [],
    settings: settingsOf(row),
    projectRoots: row.worktree_path
      ? [row.worktree_path, ...row.project_roots.slice(1)]
      : row.project_roots,
    mode: row.run_mode,
    level: row.run_level ?? DEFAULT_INVOLVEMENT_LEVEL,
    parentRunId: row.parent_run_id,
    userRequest: row.content,
    role: row.run_role,
    copyOf: row.worktree_path ? (row.run_name ?? 'Builder') : null,
    askTitle: row.run_role === 'architect' && row.title_source !== 'user',
    previousMessageId: null,
    resumeKey: row.resume_key,
    followUp: row.follow_up,
  };
}
