import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { conversationSummarySchema, type GithubInboxItem } from '@spark-outpost/contracts';
import { api, newDraftId, queryKeys, request } from '../api/client.ts';
import { queueDraft } from '../chat/composer/pending-draft.ts';
import { adoptApi } from '../chat/project/adopt-api.ts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { Glyph } from '../tickets/ticket-icons.tsx';
import { githubKeys } from './github-api.ts';
import { chatOpening } from './review/review-share.ts';

const TITLE_LIMIT = 100;
const LEFT_BEHIND = 'The new chat could not be removed.';

class StartChatError extends Error {
  constructor(
    message: string,
    readonly leftChatId: string | null,
    cause: unknown,
  ) {
    super(message, { cause });
  }
}

interface Problem {
  text: string;
  leftChatId: string | null;
}

function chatTitle(item: GithubInboxItem): string {
  return `PR #${item.number}: ${item.title}`.slice(0, TITLE_LIMIT);
}

async function startOnBranch(item: GithubInboxItem, projectId: string): Promise<string> {
  const id = crypto.randomUUID();
  await request(conversationSummarySchema, '/conversations', {
    method: 'POST',
    body: JSON.stringify({
      id,
      sessionType: 'chat',
      projectIds: [projectId],
      title: chatTitle(item),
    }),
  });
  try {
    await adoptApi.adopt(id, { projectId, number: item.number, url: item.url });
  } catch (error) {
    const removed = await api.deleteConversation(id).then(
      () => true,
      () => false,
    );
    const reason = error instanceof Error ? error.message : 'The chat could not start.';
    throw removed
      ? new StartChatError(reason, null, error)
      : new StartChatError(`${reason} ${LEFT_BEHIND}`, id, error);
  }
  return id;
}

function startWithoutProject(item: GithubInboxItem): string {
  const id = newDraftId();
  queueDraft(id, chatOpening(item));
  return id;
}

interface StartChatProps {
  item: GithubInboxItem;
  onOpenChat: (conversationId: string) => void;
}

export function StartChat({ item, onOpenChat }: StartChatProps) {
  const queryClient = useQueryClient();
  const { remote } = useRemoteClient();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  if (remote || item.conversationId) return null;
  const projectId = item.projectId;

  const start = async () => {
    if (!projectId) {
      onOpenChat(startWithoutProject(item));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const id = await startOnBranch(item, projectId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations }),
        queryClient.invalidateQueries({ queryKey: githubKeys.inbox }),
      ]);
      onOpenChat(id);
    } catch (error) {
      setProblem({
        text: error instanceof Error ? error.message : 'The chat could not start.',
        leftChatId: error instanceof StartChatError ? error.leftChatId : null,
      });
      if (error instanceof StartChatError && error.leftChatId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn line sm"
        disabled={busy}
        aria-describedby={projectId ? undefined : 'gh-start-note'}
        onClick={() => void start()}
      >
        <Glyph name="chat" size={13} />
        {busy ? 'Starting chat…' : 'Start chat'}
      </button>
      {!projectId && (
        <p id="gh-start-note" className="gh-start-note">
          This repository isn&apos;t a linked project, so the chat won&apos;t have the pull
          request&apos;s branch.
        </p>
      )}
      {problem && (
        <p className="gh-start-note bad" role="alert">
          {problem.text}{' '}
          {problem.leftChatId && (
            <button
              type="button"
              className="btn line sm"
              onClick={() => onOpenChat(problem.leftChatId!)}
            >
              Open that chat
            </button>
          )}
        </p>
      )}
    </>
  );
}
