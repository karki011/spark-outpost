import { chatShareStateLabels, type ChatContextResponse } from '@spark-outpost/contracts';
import { redactText } from '../audit/redact.ts';
import { saveAttachment } from '../persistence/attachments.ts';
import type { Queryable } from '../persistence/db.ts';
import { chatDigest, digestPreview, type ChatDigest, type ChatDigestOptions } from './digest.ts';

export const CHAT_CONTEXT_MAX_CHARS = 4_000;
const TITLE_IN_NAME_MAX = 80;

function changesLine(changes: ChatDigest['changes']): string | null {
  if (!changes) return null;
  if ('unavailable' in changes) return `Changes: not available (${changes.unavailable})`;
  if (changes.files === 0) return 'Changes: no files changed';
  const more = changes.files - changes.paths.length;
  const paths = `${changes.paths.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
  return `Changes: ${changes.files} files (+${changes.added} −${changes.removed}): ${paths}`;
}

function pendingLine({ pending }: ChatDigest): string | null {
  const parts = [
    ...(pending.waitingOn ? [pending.waitingOn] : []),
    ...pending.approvals.map((approval) => `${approval.kind} card: ${approval.title}`),
    ...(pending.queuedMessages > 0 ? [`${pending.queuedMessages} queued messages`] : []),
  ];
  return parts.length > 0 ? `Waiting on: ${[...new Set(parts)].join('; ')}` : null;
}

export function chatContextDocument(digest: ChatDigest): string {
  const facts = [
    `Chat id: ${digest.id}`,
    `Link: ${digest.link}`,
    `Projects: ${digest.projects.join(', ') || 'none'}`,
    `State: ${chatShareStateLabels[digest.state]}${digest.archived ? ' (archived)' : ''}. ${digest.live}`,
    digest.error ? `Error: ${digest.error}` : null,
    digest.branch ? `Branch: ${digest.branch}` : null,
    digest.task
      ? `Task: ${digest.task.title} (${digest.task.status}; ${digest.task.progress})`
      : null,
    changesLine(digest.changes),
    digest.pullRequests.length > 0 ? `Pull request: ${digest.pullRequests.join(', ')}` : null,
    pendingLine(digest),
    `Turns: ${digest.totalTurns}`,
  ].filter((line): line is string => line !== null);
  const text = [
    `# Shared Spark chat: ${digest.title}`,
    '',
    digest.untrusted,
    '',
    ...facts.map((fact) => `- ${fact}`),
    '',
    '## Goal',
    digest.goal ?? 'No message yet.',
    '',
    '## Last reply',
    digest.lastReply ?? 'No reply yet.',
  ].join('\n');
  const readMore = [
    '',
    '## Read more',
    `This is a snapshot, not the transcript. For the current state call the Spark tool spark_chat with {"chat":"${digest.id}","digest":true}; to page the transcript call spark_chat_history with {"chat":"${digest.id}"}. Both only read that chat.`,
    '',
  ].join('\n');
  const room = CHAT_CONTEXT_MAX_CHARS - readMore.length;
  const body = redactText(text);
  return `${body.length > room ? `${body.slice(0, room - 1)}…` : body}\n${readMore}`.slice(
    0,
    CHAT_CONTEXT_MAX_CHARS,
  );
}

function attachmentName(title: string): string {
  const plain = title.replace(/[/\\]/g, ' ').trim().slice(0, TITLE_IN_NAME_MAX).trim();
  return `Spark chat - ${plain || 'Untitled'}.md`;
}

export async function chatContextFromReference(
  db: Queryable,
  workspaceId: string,
  chatId: string,
  options: ChatDigestOptions,
): Promise<ChatContextResponse> {
  const digest = await chatDigest(db, workspaceId, chatId, { ...options, recent: 0 });
  const attachment = await saveAttachment(db, workspaceId, {
    name: attachmentName(digest.title),
    mediaType: 'text/markdown',
    data: Buffer.from(chatContextDocument(digest), 'utf8'),
  });
  return { attachment, preview: digestPreview(digest) };
}
