import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  EMPTY_CONVERSATION_USAGE,
  titleFromMessage,
  type Attachment,
} from '@spark-outpost/contracts';
import { api, newDraftId, queryKeys } from '../api/client.ts';
import { setupApi, setupKey } from '../api/setup.ts';
import { useAttachments } from '../chat/attachments/use-attachments.ts';
import { Composer } from '../chat/Composer.tsx';
import { useLinkedProjects } from '../chat/project/use-chat-repos.ts';
import { carriedSettings, isStartedChat } from './carried-settings.ts';

const NO_REPOS: string[] = [];
const STARTED_MS = 6000;

interface Outgoing {
  content: string;
  attachments: Attachment[];
}

interface HomeComposerProps {
  draftId: string;
  onRotate: (nextDraftId: string) => void;
  onOpenId: (conversationId: string) => void;
}

interface Started {
  id: string;
  title: string;
  kept: boolean;
}

function useStarted() {
  const [started, setStarted] = useState<Started | null>(null);
  useEffect(() => {
    if (!started) return;
    const timer = setTimeout(() => setStarted(null), STARTED_MS);
    return () => clearTimeout(timer);
  }, [started]);
  return [started, setStarted] as const;
}

export function HomeComposer(props: HomeComposerProps) {
  const { draftId, onRotate, onOpenId } = props;
  const queryClient = useQueryClient();
  const [started, setStarted] = useStarted();
  const detail = useQuery({
    queryKey: queryKeys.conversation(draftId),
    queryFn: () => api.getConversation(draftId),
  });
  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get });
  const connected = setup.data?.providers.filter((provider) => provider.connection) ?? [];
  const repos = useLinkedProjects(detail.data?.conversation.projectIds ?? NO_REPOS);
  const attachments = useAttachments();
  const stale = detail.data ? isStartedChat(detail.data) : false;
  useEffect(() => {
    if (stale) onRotate(newDraftId());
  }, [stale, onRotate]);
  const send = useMutation({
    mutationFn: async (message: Outgoing) => {
      const carried = carriedSettings(detail.data, connected);
      await api.sendMessage(
        draftId,
        crypto.randomUUID(),
        message.content,
        message.attachments.map((attachment) => attachment.id),
      );
      const next = newDraftId();
      const kept = carried
        ? await api.updateChatSettings(next, carried).then(
            () => true,
            () => false,
          )
        : true;
      return { next, kept, title: titleFromMessage(message.content) };
    },
    onSuccess: async ({ next, kept, title }) => {
      setStarted({ id: draftId, title, kept });
      onRotate(next);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.conversation(draftId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations, exact: true }),
      ]);
    },
  });

  return (
    <section className="home-compose" aria-label="Start a new chat">
      <Composer
        conversationId={draftId}
        repos={repos}
        settings={detail.data?.settings ?? null}
        providers={connected}
        runs={[]}
        usageTotals={EMPTY_CONVERSATION_USAGE}
        busy={false}
        sending={send.isPending}
        error={send.error?.message ?? null}
        attachments={attachments}
        onSend={async (content, files) => {
          await send.mutateAsync({ content, attachments: files });
        }}
        onStop={() => undefined}
        autoFocus={false}
      />
      <p className="home-started" role="status" aria-live="polite">
        {started && (
          <span key={started.id}>
            Started ‘{started.title}’ ·{' '}
            <button type="button" className="hlink" onClick={() => onOpenId(started.id)}>
              Open
            </button>
            {!started.kept && ' · New chats use your default model again'}
          </span>
        )}
      </p>
    </section>
  );
}
