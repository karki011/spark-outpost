import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { conversationSummarySchema, type GithubInboxItem } from '@spark-outpost/contracts';
import { api, newDraftId, queryKeys, request } from '../api/client.ts';
import { queueDraft } from '../chat/composer/pending-draft.ts';
import { adoptApi } from '../chat/project/adopt-api.ts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { Glyph } from '../tickets/ticket-icons.tsx';
import { githubKeys } from './github-api.ts';

const TITLE_LIMIT = 100;

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
    await api.deleteConversation(id).catch(() => null);
    throw error;
  }
  return id;
}

function startWithoutProject(item: GithubInboxItem): string {
  const id = newDraftId();
  queueDraft(id, `Pull request ${item.repo}#${item.number}: ${item.url}\n\n`);
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
  const [problem, setProblem] = useState<string | null>(null);
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
      setProblem(error instanceof Error ? error.message : 'The chat could not start.');
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
          {problem}
        </p>
      )}
    </>
  );
}
