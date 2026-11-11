import {
  quickAnswerOf,
  type ApprovalKind,
  type AttentionKind,
  type ConversationAttention,
  type QuickAnswer,
} from '@spark-outpost/contracts';

export interface PendingApprovalRow {
  pending_id: string | null;
  pending_kind: ApprovalKind | null;
  pending_title: string | null;
  pending_command: string | null;
  pending_paths: unknown;
  pending_agent: string | null;
  pending_member: string | null;
  pending_asker: string | null;
  pending_subagent?: string | null;
  pending_questions?: boolean | null;
  pending_plan?: boolean | null;
  pending_provider: string | null;
  pending_pr_feedback?: boolean | null;
  pending_keys?: string[] | null;
  pending_payload_command?: unknown;
  pending_payload_paths?: unknown;
  pending_payload_full_paths?: unknown;
  pending_payload_truncated?: unknown;
  pending_diffs?: number | null;
  pending_options?: unknown;
  pending_hash?: string | null;
  flag_title?: string | null;
}

const JEV = 'Jev';
const SPARK = 'Spark';

const ATTENTION_BY_APPROVAL_KIND: Record<ApprovalKind, AttentionKind> = {
  edit: 'permission',
  execute: 'permission',
  other: 'permission',
  spark_action: 'permission',
  clarify: 'input',
  plan: 'plan',
  retry: 'input',
  accept: 'review',
  budget: 'input',
  merge_conflict: 'input',
  stuck: 'stuck',
  verify: 'input',
  ownership: 'input',
  pieces: 'plan',
  pr_split: 'input',
  compact: 'input',
};

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function lowerFirst(text: string): string {
  if (/^[A-Z][a-z]/.test(text)) return `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
  return text;
}

function stringPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function permissionTitle(row: PendingApprovalRow, kind: ApprovalKind): string {
  const title = row.pending_title?.trim() ?? '';
  if (kind === 'execute') return `run ${row.pending_command?.trim() || title}`.trim();
  if (kind === 'edit') {
    const files = stringPaths(row.pending_paths);
    if (files.length === 1) return `edit ${baseName(files[0]!)}`;
    if (files.length > 1) return `edit ${files.length} files`;
    return 'change files';
  }
  return lowerFirst(title) || 'take an action';
}

function agentFor(row: PendingApprovalRow, kind: ApprovalKind): string | null {
  if (kind === 'clarify' && row.pending_questions) return row.pending_asker ?? SPARK;
  if (kind === 'clarify') return row.pending_asker ?? JEV;
  if (kind === 'stuck') return row.pending_asker;
  if (kind === 'plan' || kind === 'accept') return row.pending_member ?? row.pending_agent;
  if (ATTENTION_BY_APPROVAL_KIND[kind] === 'permission') return row.pending_agent;
  return null;
}

function flagAttention(row: PendingApprovalRow): ConversationAttention | null {
  if (!row.flag_title) return null;
  return { kind: 'flag', title: row.flag_title, agentName: null, provider: null, approvalId: null };
}

function quickFor(row: PendingApprovalRow, kind: ApprovalKind): QuickAnswer | null {
  if (!row.pending_keys || row.pending_pr_feedback) return null;
  return quickAnswerOf({
    kind,
    payloadKeys: row.pending_keys,
    command: row.pending_payload_command,
    paths: row.pending_payload_paths,
    fullPaths: row.pending_payload_full_paths,
    truncated: row.pending_payload_truncated,
    diffCount: row.pending_diffs ?? 0,
    options: row.pending_options,
    payloadHash: row.pending_hash ?? null,
  });
}

export function toAttention(row: PendingApprovalRow): ConversationAttention | null {
  const kind = row.pending_kind;
  if (!row.pending_id || !kind) return flagAttention(row);
  const attention = row.pending_plan ? 'plan' : ATTENTION_BY_APPROVAL_KIND[kind];
  const quick = attention === 'permission' ? quickFor(row, kind) : null;
  return {
    kind: attention,
    title: attention === 'permission' ? permissionTitle(row, kind) : (row.pending_title ?? ''),
    agentName: agentFor(row, kind),
    provider: kind === 'clarify' && !row.pending_asker ? 'jev' : row.pending_provider,
    approvalId: row.pending_id,
    ...(row.pending_pr_feedback ? { prFeedback: true } : {}),
    ...(attention === 'permission' && row.pending_subagent
      ? { subagent: row.pending_subagent }
      : {}),
    ...(quick ? { quick } : {}),
  };
}
