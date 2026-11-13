import './meeting-ask.css';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  EMPTY_CONVERSATION_USAGE,
  type Attachment,
  type Meeting,
  type Message,
} from '@spark-outpost/contracts';
import { invalidateChatDetail } from '../api/chat-detail.ts';
import { api, queryKeys } from '../api/client.ts';
import { setupApi, setupKey } from '../api/setup.ts';
import { useAttachments } from '../chat/attachments/use-attachments.ts';
import { Composer } from '../chat/Composer.tsx';
import { Markdown } from '../chat/markdown/Markdown.tsx';
import { activeRuns } from '../chat/turns.ts';
import { useStop } from '../chat/use-stop.ts';
import { SparkleIcon } from '../ui/icons.tsx';
import { copyButtonText, useCopyFeedback } from '../ui/use-copy-feedback.ts';
import { askPresets, meetingAttachment, meetingChatId } from './meeting-ask.ts';

interface MeetingAskProps {
  meeting: Meeting;
  onOpenChat: ((id: string) => void) | undefined;
}

interface Outgoing {
  content: string;
  files: Attachment[];
}

const WAIT_POLL_MS = 1_500;
const NO_REPOS: never[] = [];

function Answer({ text }: { text: string }) {
  const copy = useCopyFeedback();
  return (
    <div className="mt-ask-answer">
      <Markdown text={text} />
      <button type="button" className="btn ghost sm" onClick={() => copy.copy(text)}>
        {copyButtonText(copy.state)}
      </button>
    </div>
  );
}

function Entry({ message }: { message: Message }) {
  return (
    <li className="mt-ask-exchange">
      {message.role === 'user' ? (
        <p className="mt-ask-question">{message.content}</p>
      ) : (
        <Answer text={message.content} />
      )}
    </li>
  );
}

export function MeetingAsk({ meeting, onOpenChat }: MeetingAskProps) {
  const ids = useId();
  const queryClient = useQueryClient();
  const [chatId] = useState(() => meetingChatId(meeting.id));
  const thread = useRef<HTMLOListElement>(null);
  const detail = useQuery({
    queryKey: queryKeys.conversation(chatId),
    queryFn: () => api.getConversation(chatId),
  });
  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get });
  const connected = useMemo(
    () => setup.data?.providers.filter((provider) => provider.connection) ?? [],
    [setup.data],
  );
  const attachments = useAttachments();
  const refresh = () => invalidateChatDetail(queryClient, chatId);
  const stop = useStop(chatId, detail.data, refresh);
  const running = activeRuns(detail.data).length > 0;
  const messages = detail.data?.messages ?? [];
  const waitingCards = (detail.data?.approvals ?? []).filter((card) => card.status === 'pending');

  const send = useMutation({
    mutationFn: async ({ content, files }: Outgoing) => {
      const note = await meetingAttachment(meeting.id);
      await api.sendMessage(chatId, crypto.randomUUID(), content, [
        note.id,
        ...files.map((file) => file.id),
      ]);
    },
    onSuccess: async () => {
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations, exact: true }),
      ]);
    },
  });

  const live = running || send.isPending;
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void invalidateChatDetail(queryClient, chatId), WAIT_POLL_MS);
    return () => clearInterval(timer);
  }, [live, chatId, queryClient]);

  const shown = `${messages.length}:${messages.at(-1)?.content.length ?? 0}:${live}`;
  useEffect(() => {
    const list = thread.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [shown]);

  const started = messages.length > 0;

  return (
    <section className="mt-ask" aria-labelledby={`${ids}-title`}>
      <div className="mt-ask-head">
        <h3 id={`${ids}-title`} className="mt-ask-title">
          <SparkleIcon />
          Ask about this meeting
          <span className="mt-ask-note">
            Sends the transcript, notes and goal with each question
          </span>
        </h3>
        {started && onOpenChat && (
          <button type="button" className="btn ghost sm" onClick={() => onOpenChat(chatId)}>
            Open chat
          </button>
        )}
      </div>
      {(started || live) && (
        <ol ref={thread} className="mt-ask-thread" aria-label="Questions about this meeting">
          {messages.map((message) => (
            <Entry key={message.id} message={message} />
          ))}
          {live && (
            <li className="mt-hint" role="status">
              Answering…
            </li>
          )}
        </ol>
      )}
      {waitingCards.length > 0 && (
        <p className="mt-ask-card" role="status">
          This chat is waiting for your answer.
          {onOpenChat && (
            <button type="button" className="btn line sm" onClick={() => onOpenChat(chatId)}>
              Open chat
            </button>
          )}
        </p>
      )}
      <div className="mt-ask-presets" role="group" aria-label="Quick questions">
        {askPresets(meeting.state === 'recording').map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="btn line sm"
            disabled={live || !detail.data}
            onClick={() => send.mutate({ content: preset.question, files: [] })}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <Composer
        conversationId={chatId}
        repos={NO_REPOS}
        noProject
        settings={detail.data?.settings ?? null}
        providers={connected}
        runs={detail.data?.runs ?? []}
        usageTotals={detail.data?.usageTotals ?? EMPTY_CONVERSATION_USAGE}
        busy={running}
        stopping={stop.stopping}
        sending={send.isPending}
        ready={Boolean(detail.data)}
        error={send.error?.message ?? stop.error}
        attachments={attachments}
        onSend={async (content, files) => {
          await send.mutateAsync({ content, files });
        }}
        onStop={stop.stop}
        autoFocus={false}
      />
    </section>
  );
}
