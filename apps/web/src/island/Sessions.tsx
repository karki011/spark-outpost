import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ChatUpdate, ConversationSummary } from '@spark-outpost/contracts';
import { approvalsApi } from '../api/approvals.ts';
import { api, queryKeys } from '../api/client.ts';
import { ProviderBlob } from '../brand/ProviderBlob.tsx';
import { providerName } from '../chat/provider-name.ts';
import { CrewBlob } from '../crew/CrewBlob.tsx';
import { rowState } from '../conversations/row-state.ts';
import { relativeTime } from '../ui/relative-time.ts';
import { islandApi } from './island-api.ts';
import {
  ACTIVE_MS,
  matchesQuery,
  sessionState,
  type Panel,
  type SessionState,
} from './island-model.ts';
import { sessionExpression } from './island-mood.ts';
import { RunDots, useArmed } from './island-parts.tsx';
import { PanelTabs } from './PanelTabs.tsx';
import { SessionBlob } from './SessionBlob.tsx';
import { chatAgent } from './use-island-data.ts';
import { roleLabel } from './work-items.ts';

const SHOWN = 5;

interface SessionsProps {
  chats: readonly ConversationSummary[];
  projectNames: ReadonlyMap<string, string>;
  selected: string | null;
  waiting: number;
  now: number;
  focusDelay: number;
  onSelect: (id: string | null) => void;
  onTab: (panel: Panel) => void;
  onOpenChat: (id: string) => void;
  onReply: (chat: ConversationSummary) => void;
}

function waitingChip(chat: ConversationSummary): string {
  if (chat.attention?.prFeedback) return 'PR feedback';
  return chat.attention?.kind === 'input' ? 'Has a question' : 'Waiting for you';
}

function StateChip({ chat, state }: { chat: ConversationSummary; state: SessionState }) {
  switch (state) {
    case 'working':
      return (
        <span className="isl-schip run">
          <RunDots />
          Working
        </span>
      );
    case 'waiting':
      return <span className="isl-schip wait">{waitingChip(chat)}</span>;
    case 'failed':
      return <span className="isl-schip bad">Failed</span>;
    case 'done':
      return <span className="isl-schip">Done · {relativeTime(chat.updatedAt)}</span>;
    case 'idle':
      return <span className="isl-schip">{relativeTime(chat.updatedAt)}</span>;
  }
}

const GROUPS = [
  { id: 'needs', label: 'Needs you' },
  { id: 'running', label: 'Running' },
  { id: 'recent', label: 'Recent' },
  { id: 'earlier', label: 'Earlier' },
] as const;

function groupOf(chat: ConversationSummary, now: number): (typeof GROUPS)[number]['id'] {
  const state = sessionState(chat);
  if (state === 'waiting') return 'needs';
  if (state === 'working') return 'running';
  if (now - Date.parse(chat.updatedAt) <= ACTIVE_MS) return 'recent';
  return 'earlier';
}

const GROUP_RANK = new Map(GROUPS.map((group, index) => [group.id, index]));

function byGroup(chats: readonly ConversationSummary[], now: number): ConversationSummary[] {
  return chats.toSorted(
    (a, b) => GROUP_RANK.get(groupOf(a, now))! - GROUP_RANK.get(groupOf(b, now))!,
  );
}

function sessionGroups(chats: readonly ConversationSummary[], now: number) {
  const indexed = chats.map((chat, index) => ({ chat, index, group: groupOf(chat, now) }));
  return GROUPS.map((group) => ({
    ...group,
    chats: indexed.filter((item) => item.group === group.id),
  })).filter((group) => group.chats.length > 0);
}

function projectLine(chat: ConversationSummary, names: ReadonlyMap<string, string>): string {
  const project = chat.projectIds.map((id) => names.get(id)).find(Boolean) ?? 'No project';
  const provider = chat.latestRun?.provider;
  return provider ? `${project} · ${providerName(provider)}` : project;
}

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

function PendingInline({ chat }: { chat: ConversationSummary }) {
  const detail = useQuery({
    queryKey: queryKeys.conversation(chat.id),
    queryFn: () => api.getConversation(chat.id),
  });
  const approval = detail.data?.approvals.find(
    (candidate) =>
      candidate.status === 'pending' &&
      candidate.kind === 'execute' &&
      !candidate.payload.forcePush &&
      !candidate.payload.gitControl &&
      !candidate.payload.instructionFiles,
  );
  const armed = useArmed(approval?.id ?? 'none');
  const decide = useMutation({
    mutationFn: (optionId: string) =>
      approvalsApi.decide(approval!.id, {
        optionId,
        scope: 'once',
        payloadHash: approval!.payloadHash,
      }),
  });
  if (!approval?.payload.command) return null;
  const allow = approval.options.find((option) => option.kind === 'allow_once');
  const deny = approval.options.find((option) => option.kind === 'reject_once');
  if (decide.isSuccess)
    return (
      <p className="isl-hint" role="status">
        Answered.
      </p>
    );
  return (
    <div className="isl-spend">
      <div className="isl-code">
        <span className="dim">$ </span>
        {approval.payload.command}
      </div>
      <div className="isl-acts">
        {deny && (
          <button
            type="button"
            className="isl-btn"
            data-arming={!armed || undefined}
            disabled={!armed || decide.isPending}
            onClick={() => decide.mutate(deny.optionId)}
          >
            Deny
          </button>
        )}
        {allow && (
          <button
            type="button"
            className="isl-btn primary"
            data-arming={!armed || undefined}
            disabled={!armed || decide.isPending}
            onClick={() => decide.mutate(allow.optionId)}
          >
            Allow once
          </button>
        )}
      </div>
      {decide.isError && (
        <p className="isl-err" role="alert">
          {decide.error.message}
        </p>
      )}
    </div>
  );
}

export function SessionDetail({
  chat,
  projectNames,
  onBack,
  onOpenChat,
  onReply,
}: {
  chat: ConversationSummary;
  projectNames: ReadonlyMap<string, string>;
  onBack: (() => void) | null;
  onOpenChat: (id: string) => void;
  onReply: (chat: ConversationSummary) => void;
}) {
  const state = sessionState(chat);
  const detail = useQuery({
    queryKey: queryKeys.conversation(chat.id),
    queryFn: () => api.getConversation(chat.id),
  });
  const agent = chatAgent(chat, detail.data);
  const update = useMutation({ mutationFn: () => islandApi.chatUpdate(chat.id) });
  const askRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => askRef.current?.focus({ preventScroll: true }), 60);
    return () => clearTimeout(timer);
  }, [chat.id]);
  const status = rowState(chat, false).sub || (state === 'done' ? 'Finished' : 'Quiet');
  return (
    <div className="isl-detail">
      {onBack && (
        <button type="button" className="isl-back" onClick={onBack} aria-label="Back to sessions">
          ‹ Sessions
        </button>
      )}
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
      {agent.crew.length > 1 && (
        <div className="isl-crew-row">
          {agent.crew.map((member) => (
            <span
              key={member.id}
              className="isl-crew-mini"
              title={`${member.name} · ${roleLabel(member.role) ?? ''}`}
            >
              <CrewBlob
                name={member.name}
                provider={member.provider}
                state={member.state}
                size={18}
              />
              <small>{member.name}</small>
            </span>
          ))}
        </div>
      )}
      {state === 'waiting' && <PendingInline chat={chat} />}
      <UpdateBox update={update.data} pending={update.isPending} />
      {update.isError && (
        <p className="isl-err" role="alert">
          {update.error.message}
        </p>
      )}
      <div className="isl-acts">
        <button
          ref={askRef}
          type="button"
          className="isl-btn primary"
          disabled={update.isPending}
          onClick={() => update.mutate()}
        >
          Ask for update
        </button>
        <button type="button" className="isl-btn" onClick={() => onReply(chat)}>
          Reply
        </button>
        <button type="button" className="isl-btn link" onClick={() => onOpenChat(chat.id)}>
          Open in Spark
        </button>
      </div>
      <p className="isl-snote">
        Asking for an update doesn’t interrupt the agent. It’s written from what Spark already
        tracks.
      </p>
    </div>
  );
}

export function Sessions(props: SessionsProps) {
  const { chats, projectNames, selected, onSelect } = props;
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = byGroup(
    chats.filter((chat) => matchesQuery(chat, projectNames, query)),
    props.now,
  );
  const shown = matches.slice(0, SHOWN);
  const current = Math.min(active, Math.max(0, shown.length - 1));
  const picked = selected ? chats.find((chat) => chat.id === selected) : undefined;

  useEffect(() => {
    if (picked) return;
    const timer = setTimeout(
      () => inputRef.current?.focus({ preventScroll: true }),
      props.focusDelay,
    );
    return () => clearTimeout(timer);
  }, [picked, props.focusDelay]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const count = shown.length;
    if (event.key === 'ArrowDown' && count) setActive((current + 1) % count);
    else if (event.key === 'ArrowUp' && count) setActive((current - 1 + count) % count);
    else if (event.key === 'Enter' && count) onSelect(shown[current]!.id);
    else return;
    event.preventDefault();
  };

  return (
    <div className="isl-body">
      <PanelTabs panel="sessions" waiting={props.waiting} onTab={props.onTab} />
      {picked ? (
        <SessionDetail
          chat={picked}
          projectNames={projectNames}
          onBack={() => onSelect(null)}
          onOpenChat={props.onOpenChat}
          onReply={props.onReply}
        />
      ) : (
        <>
          <div className="isl-search">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="m10.5 10.5 3 3"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <label className="sr-only" htmlFor="isl-squery">
              Search sessions
            </label>
            <input
              id="isl-squery"
              ref={inputRef}
              type="search"
              placeholder="Search sessions by title or project"
              autoComplete="off"
              role="combobox"
              aria-expanded="true"
              aria-controls="isl-slist"
              aria-activedescendant={shown[current] ? `isl-sopt-${shown[current].id}` : undefined}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          {shown.length > 0 ? (
            <div className="isl-slist" id="isl-slist" role="listbox" aria-label="Recent sessions">
              {sessionGroups(shown, props.now).map((group) => (
                <div
                  key={group.label}
                  role="group"
                  aria-labelledby={`isl-sg-${group.id}`}
                  className="isl-sgroup"
                >
                  <div id={`isl-sg-${group.id}`} className="isl-hhead" role="presentation">
                    {group.label}
                  </div>
                  {group.chats.map(({ chat, index }) => {
                    const state = sessionState(chat);
                    return (
                      <div
                        key={chat.id}
                        id={`isl-sopt-${chat.id}`}
                        role="option"
                        aria-selected={index === current}
                        className={index === current ? 'isl-srow act' : 'isl-srow'}
                        onClick={() => onSelect(chat.id)}
                      >
                        <SessionBlob
                          chat={chat}
                          state={state}
                          size={22}
                          expression={sessionExpression(state, false)}
                        />
                        <div className="isl-smain">
                          <div className="isl-st">{chat.title}</div>
                          <div className="isl-sp2">{projectLine(chat, projectNames)}</div>
                        </div>
                        <StateChip chat={chat} state={state} />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <div className="isl-sempty">
              {query ? `No session matches “${query}”.` : 'No chats yet.'}
            </div>
          )}
          {matches.length > SHOWN && (
            <div className="isl-sfoot">
              {matches.length - SHOWN} more, keep typing to narrow it down
            </div>
          )}
        </>
      )}
    </div>
  );
}
