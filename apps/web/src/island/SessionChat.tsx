import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatUpdate, ConversationDetail, ConversationSummary } from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import { ProviderBlob } from '../brand/ProviderBlob.tsx';
import { ApprovalCard } from '../chat/approvals/ApprovalCard.tsx';
import { CheckpointCard } from '../chat/checkpoints/CheckpointCard.tsx';
import { isCheckpoint } from '../chat/checkpoints/checkpoint-model.ts';
import { Markdown } from '../chat/markdown/Markdown.tsx';
import { rowState } from '../conversations/row-state.ts';
import { SecretWarning } from '../ui/SecretWarning.tsx';
import { useSecretGuard } from '../ui/use-secret-guard.ts';
import { islandApi } from './island-api.ts';
import { sessionState } from './island-model.ts';
import { projectLine, StateChip } from './session-bits.tsx';
import { SessionBlob } from './SessionBlob.tsx';
import { chatAgent, pendingOf } from './use-island-data.ts';

const RECENT_MESSAGES = 6;

function UpdateBox({ update, pending }: { update: ChatUpdate | undefined; pending: boolean }) {
  if (!pending && !update) return null;
  return (
    <div className="isl-supd" aria-busy={pending || undefined}>
      <div className="isl-jtag">
        <span className="isl-blob" aria-hidden="true">
          <ProviderBlob providerId="jev" size={15} expression={pending ? 'thinking' : 'happy'} />
        </span>
        {update?.by === 'rules' ? 'Spark' : 'Jev'}
        <span className="isl-sub"> · {pending ? 'writing an update…' : 'update · just now'}</span>
      </div>
      {pending ? (
        <div className="isl-skl" aria-hidden="true">
          <i />
          <i />
          <i style={{ width: '58%' }} />
        </div>
      ) : (
        <div role="status">
          {update!.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function Messages({ detail }: { detail: ConversationDetail | undefined }) {
  const logRef = useRef<HTMLDivElement>(null);
  const messages = (detail?.messages ?? [])
    .filter((message) => message.content.trim())
    .slice(-RECENT_MESSAGES);
  const last = messages.at(-1)?.id;
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [last]);
  if (messages.length === 0) return null;
  return (
    <div ref={logRef} className="isl-chatlog" role="log" aria-label="Recent messages">
      {messages.map((message) =>
        message.role === 'user' ? (
          <p key={message.id} className="isl-ask-q">
            {message.content}
          </p>
        ) : (
          <div key={message.id} className="isl-ask-md isl-chat-a">
            <Markdown text={message.content} />
          </div>
        ),
      )}
    </div>
  );
}

function Actions({ detail, provider }: { detail: ConversationDetail; provider: string }) {
  const pending = pendingOf(detail).filter((approval) => approval.status === 'pending');
  if (pending.length === 0) return null;
  return (
    <div className="isl-chat-cards" aria-label="Waiting for you" role="group" tabIndex={-1}>
      {pending.map((approval) =>
        isCheckpoint(approval) ? (
          <CheckpointCard key={approval.id} approval={approval} />
        ) : (
          <ApprovalCard key={approval.id} approval={approval} provider={provider} repo={null} />
        ),
      )}
    </div>
  );
}

function Reply({ chat }: { chat: ConversationSummary }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const secrets = useSecretGuard(text);
  const send = useMutation({
    mutationFn: (content: string) => api.sendMessage(chat.id, crypto.randomUUID(), content),
    onSuccess: () => {
      setText('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversation(chat.id) });
    },
  });
  const submit = () => {
    const content = text.trim();
    if (!content || send.isPending || secrets.blocks(text)) return;
    send.mutate(content);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };
  return (
    <div className="isl-qc">
      <SecretWarning guard={secrets} input={inputRef} onText={setText} onSendAnyway={submit} />
      <label className="sr-only" htmlFor={`isl-reply-${chat.id}`}>
        Reply to {chat.title}
      </label>
      <textarea
        id={`isl-reply-${chat.id}`}
        ref={inputRef}
        rows={1}
        placeholder="Reply…"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="isl-qc-bar">
        <span className="isl-qc-hint">{send.isPending ? 'Sending…' : ''}</span>
        <span className="isl-sp" />
        <button
          type="button"
          className="isl-send"
          aria-label="Send reply"
          disabled={!text.trim() || send.isPending}
          onClick={submit}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M8 13V3M3.5 7.5 8 3l4.5 4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            />
          </svg>
        </button>
      </div>
      {send.isError && (
        <p className="isl-err" role="alert">
          {send.error.message}
        </p>
      )}
    </div>
  );
}

interface SessionChatProps {
  chat: ConversationSummary;
  projectNames: ReadonlyMap<string, string>;
  onBack: () => void;
  onOpenChat: (id: string) => void;
}

export function SessionChat({ chat, projectNames, onBack, onOpenChat }: SessionChatProps) {
  const state = sessionState(chat);
  const detail = useQuery({
    queryKey: queryKeys.conversation(chat.id),
    queryFn: () => api.getConversation(chat.id),
  });
  const agent = chatAgent(chat, detail.data);
  const update = useMutation({ mutationFn: () => islandApi.chatUpdate(chat.id) });
  const rootRef = useRef<HTMLDivElement>(null);
  const waiting = detail.data
    ? pendingOf(detail.data).some((approval) => approval.status === 'pending')
    : false;

  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => {
      const card = rootRef.current?.querySelector<HTMLElement>('.isl-chat-cards');
      card?.scrollIntoView({ block: 'nearest' });
      card?.focus({ preventScroll: true });
    }, 120);
    return () => clearTimeout(timer);
  }, [waiting, chat.id]);

  const status = rowState(chat, false).sub || (state === 'done' ? 'Finished' : 'Quiet');
  return (
    <div ref={rootRef} className="isl-detail isl-chat">
      <button type="button" className="isl-back" onClick={onBack} aria-label="Back to sessions">
        ‹ Sessions
      </button>
      <div className="isl-shead">
        <SessionBlob chat={chat} state={state} size={30} />
        <div className="isl-smain">
          <div className="isl-st big">{chat.title}</div>
          <div className="isl-sp2">
            {projectLine(chat, projectNames)}
            {agent.crew.length > 0 && ` · ${agent.crew.map((member) => member.name).join(', ')}`}
          </div>
        </div>
        <StateChip chat={chat} state={state} />
      </div>
      <div className="isl-sstatus">
        <span className={state === 'working' ? 'shim' : ''}>
          {state === 'working' && agent.name ? `${agent.name} · ` : ''}
          {status}
        </span>
      </div>
      <div className="isl-chat-scroll">
        <Messages detail={detail.data} />
        {detail.data && (
          <Actions
            detail={detail.data}
            provider={chat.latestRun?.provider ?? agent.provider ?? 'claude'}
          />
        )}
        <UpdateBox update={update.data} pending={update.isPending} />
      </div>
      {update.isError && (
        <p className="isl-err" role="alert">
          {update.error.message}
        </p>
      )}
      <Reply chat={chat} />
      <div className="isl-acts">
        <button
          type="button"
          className="isl-btn"
          disabled={update.isPending}
          onClick={() => update.mutate()}
        >
          Ask for update
        </button>
        <button type="button" className="isl-btn link" onClick={() => onOpenChat(chat.id)}>
          Open in Spark
        </button>
      </div>
    </div>
  );
}
