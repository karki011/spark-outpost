import './outpost-thread-pane.css';
import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from '../api/client.ts';
import { requestMessageJump } from '../chat/message-jump.ts';
import { useQuotes } from '../chat/quotes/use-quotes.ts';
import { useChatSend } from '../chat/send/use-chat-send.ts';
import { Thread } from '../chat/Thread.tsx';
import { latestReplyId } from '../chat/turns.ts';
import { BackIcon, ExternalLinkIcon } from '../ui/icons.tsx';
import { LoadingBlob } from '../ui/loading/LoadingBlob.tsx';
import { MemberFace } from './MemberFace.tsx';
import { SteerBox } from './SteerBox.tsx';
import { StatusPill } from './StatusPill.tsx';
import { outpostKeys } from './outposts-api.ts';
import { receiverName } from './post-text.ts';
import type { ThreadCard } from './thread-cards.ts';

interface ThreadPaneProps {
  outpostId: string;
  card: ThreadCard;
  canSteer: boolean;
  answerable: boolean;
  onBack: () => void;
  onOpenChat: (conversationId: string) => void;
  onCancel: (postId: string) => void;
}

const NO_REPOS: never[] = [];

export function isBackKey(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>): boolean {
  if (event.key === 'Escape') return true;
  return event.key === '[' && (event.metaKey || event.ctrlKey);
}

function useMemberChat(outpostId: string, chatId: string) {
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: queryKeys.conversation(chatId),
    queryFn: () => api.getConversation(chatId),
  });
  const savedIds = useMemo(
    () => new Set(detail.data?.messages.map((message) => message.id)),
    [detail.data?.messages],
  );
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.conversation(chatId) }),
      client.invalidateQueries({ queryKey: outpostKeys.detail(outpostId) }),
    ]);
  const sends = useChatSend(chatId, savedIds, refresh);
  const latest = useMemo(() => (detail.data ? latestReplyId(detail.data) : null), [detail.data]);
  const quotes = useQuotes(chatId, latest);
  return { detail, sends, quotes };
}

export function ThreadPane({
  outpostId,
  card,
  canSteer,
  answerable,
  onBack,
  onOpenChat,
  onCancel,
}: ThreadPaneProps) {
  const { post } = card;
  const chatId = post.toConversationId ?? '';
  const to = receiverName(post);
  const backRef = useRef<HTMLButtonElement>(null);
  const { detail, sends, quotes } = useMemberChat(outpostId, chatId);
  const chat = detail.data?.conversation;
  const loaded = detail.data !== undefined;

  useEffect(() => {
    backRef.current?.focus();
  }, [post.id]);

  useEffect(() => {
    if (!loaded) return;
    requestMessageJump(chatId, { messageId: post.id, runId: post.runId, parts: [] });
  }, [chatId, post.id, post.runId, loaded]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!isBackKey(event)) return;
    event.preventDefault();
    event.stopPropagation();
    onBack();
  };

  const needsYou = post.state === 'needs_you' && answerable;
  return (
    <aside
      className="op-pane op-thread-pane"
      aria-label={`Thread with ${to}`}
      onKeyDown={onKeyDown}
    >
      <div className="op-thread-head">
        <button
          ref={backRef}
          type="button"
          className="icon-btn"
          aria-label="Back to Overview"
          aria-keyshortcuts="Escape Meta+BracketLeft"
          onClick={onBack}
        >
          <BackIcon />
        </button>
        <MemberFace chatId={chatId} size="post" />
        <div className="op-thread-who">
          <b>
            {to}
            <StatusPill status={card.status} label={card.pill} />
          </b>
          <span>{chat?.title ?? card.title}</span>
        </div>
        <button
          type="button"
          className="btn sm line"
          aria-label={`Open ${to} in chat`}
          onClick={() => onOpenChat(chatId)}
        >
          <ExternalLinkIcon />
          Open chat
        </button>
      </div>
      <div className="op-thread-body">
        {detail.data ? (
          <Thread
            detail={detail.data}
            repos={NO_REPOS}
            sends={sends}
            taskId={null}
            onOpenChat={onOpenChat}
            quotes={quotes}
          />
        ) : (
          <LoadingBlob size="lg" className="thread-loading" line="Opening the thread…" />
        )}
      </div>
      {(canSteer || needsYou) && (
        <SteerBox
          handle={to}
          answering={needsYou}
          canStop={canSteer && post.state === 'working'}
          sending={sends.sending}
          onSend={(content) => sends.send({ content, attachments: [] })}
          onStop={() => onCancel(post.id)}
        />
      )}
    </aside>
  );
}
