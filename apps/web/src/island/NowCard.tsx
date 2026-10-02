import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  isTerminalRunStatus,
  type ConversationDetail,
  type ConversationSummary,
} from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import { BlobScout } from '../brand/BlobScout.tsx';
import { viewSteps, type StepView } from '../chat/run-projection.ts';
import { rowState } from '../conversations/row-state.ts';
import { ExternalLinkIcon } from '../ui/icons.tsx';
import { activityLines, stepCount, type ActivityLine } from './home-model.ts';
import { hopIn, tickUp } from './home-motion.ts';
import { sessionState, type SessionState } from './island-model.ts';
import { sessionExpression } from './island-mood.ts';
import { RunDots } from './island-parts.tsx';
import { SessionBlob } from './SessionBlob.tsx';
import { chatAgent } from './use-island-data.ts';

const HOLD_MS = 550;
const SWIPE_PX = 40;
const WHEEL_GAP_MS = 380;

export interface QuickStart {
  id: string;
  name: string;
}

interface NowCardProps {
  sessions: readonly ConversationSummary[];
  reduced: boolean;
  sleepy: boolean;
  quickStart: QuickStart | null;
  onOpenHere: (id: string) => void;
  onOpenChat: (id: string) => void;
  onAsk: () => void;
  onNewIn: (projectId: string) => void;
}

function runSteps(chat: ConversationSummary, detail: ConversationDetail | undefined): StepView[] {
  if (!detail) return [];
  const live = detail.runs
    .filter((run) => !isTerminalRunStatus(run.status))
    .map((run) => run.id)
    .toReversed();
  for (const id of [chat.latestRun?.id, ...live]) {
    const steps = id ? detail.activity[id] : undefined;
    if (steps?.length) return viewSteps(steps);
  }
  return [];
}

function agentLine(chat: ConversationSummary, detail: ConversationDetail | undefined): string {
  const agent = chatAgent(chat, detail);
  const model = detail?.runs
    .find((run) => run.id === chat.latestRun?.id)
    ?.model?.replace(/\[.*\]$/, '');
  return [chat.teammate?.name ?? agent.name, model].filter(Boolean).join(' · ');
}

function StateBadge({ state }: { state: SessionState }) {
  switch (state) {
    case 'working':
      return (
        <span className="isl-now-badge run" aria-hidden="true">
          <RunDots />
        </span>
      );
    case 'waiting':
      return (
        <span className="isl-now-badge wait" aria-hidden="true">
          !
        </span>
      );
    case 'done':
      return (
        <span className="isl-now-badge ok" aria-hidden="true">
          ✓
        </span>
      );
    case 'failed':
      return (
        <span className="isl-now-badge bad" aria-hidden="true">
          !
        </span>
      );
    default:
      return null;
  }
}

function Mark({ state }: { state: ActivityLine['state'] }) {
  if (state === 'active') return <span className="isl-now-mark" aria-hidden="true" />;
  return (
    <svg className="isl-now-mark" width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d={state === 'failed' ? 'm3 3 6 6m0-6-6 6' : 'm2.5 6.5 2.5 2.5 4.5-5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

const STATE_WORDS: Record<ActivityLine['state'], string> = {
  done: 'Done',
  active: 'Now',
  failed: 'Failed',
};

function ActivityLog({ lines, reduced }: { lines: ActivityLine[]; reduced: boolean }) {
  const listRef = useRef<HTMLOListElement>(null);
  const lastKey = lines.at(-1)?.key ?? null;
  const previous = useRef(lastKey);

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = lastKey;
    const list = listRef.current;
    if (reduced || !list || before === null || before === lastKey) return;
    tickUp(list, list.firstElementChild?.getBoundingClientRect().height ?? 18);
  }, [lastKey, reduced]);

  return (
    <div className="isl-now-logwrap">
      <ol ref={listRef} className="isl-now-log" aria-label="Latest steps">
        {lines.map((line) => (
          <li key={line.key} data-state={line.state} data-kind={line.kind}>
            <Mark state={line.state} />
            <span className="sr-only">{STATE_WORDS[line.state]}: </span>
            <span className="isl-now-verb">{line.verb}</span>
            {line.target && (
              <>
                <span aria-hidden="true"> · </span>
                <span className="isl-now-target">{line.target}</span>
              </>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function OpenButton({ chat, onOpenHere, onOpenChat }: Omit<SessionProps, 'reduced'>) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const held = useRef(false);
  const release = () => clearTimeout(timer.current);
  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (held.current) {
      held.current = false;
      return;
    }
    if (event.metaKey || event.ctrlKey) onOpenChat(chat.id);
    else onOpenHere(chat.id);
  };
  return (
    <button
      type="button"
      className="isl-now-open"
      aria-label={`Open ${chat.title}`}
      title="Open here · ⌘-click or hold to open in Spark"
      onClick={onClick}
      onPointerDown={() => {
        held.current = false;
        timer.current = setTimeout(() => {
          held.current = true;
          onOpenChat(chat.id);
        }, HOLD_MS);
      }}
      onPointerUp={release}
      onPointerLeave={release}
    >
      <ExternalLinkIcon />
    </button>
  );
}

interface SessionProps {
  chat: ConversationSummary;
  reduced: boolean;
  onOpenHere: (id: string) => void;
  onOpenChat: (id: string) => void;
}

function NowSession({ chat, reduced, onOpenHere, onOpenChat }: SessionProps) {
  const detail = useQuery({
    queryKey: queryKeys.conversation(chat.id),
    queryFn: () => api.getConversation(chat.id),
  });
  const state = sessionState(chat);
  const live = state === 'working' || state === 'waiting';
  const lines = activityLines(runSteps(chat, detail.data), live);
  const count = stepCount(chat.latestRun?.progress);
  const status = rowState(chat, false).sub || (state === 'done' ? 'Finished' : 'Quiet');
  return (
    <div className="isl-now-text">
      <div className="isl-now-head">
        <span className="isl-now-dot" data-state={state} aria-hidden="true" />
        <b className="isl-now-title">{chat.title}</b>
        <span className="isl-now-agent">{agentLine(chat, detail.data)}</span>
        <span className="isl-sp" />
        {count && (
          <span className="isl-now-steps">
            <span className="sr-only">
              Step {count.current} of {count.total}
            </span>
            <span aria-hidden="true">
              <span key={count.current} className="isl-tick">
                {count.current}
              </span>
              /{count.total}
            </span>
          </span>
        )}
        <OpenButton chat={chat} onOpenHere={onOpenHere} onOpenChat={onOpenChat} />
      </div>
      {detail.isPending ? (
        <div className="isl-skl isl-now-skl" aria-hidden="true">
          <i />
          <i style={{ width: '64%' }} />
        </div>
      ) : lines.length > 0 ? (
        <ActivityLog lines={lines} reduced={reduced} />
      ) : (
        <p className="isl-now-status">{status}</p>
      )}
    </div>
  );
}

function NowEmpty({
  quickStart,
  onAsk,
  onNewIn,
}: Pick<NowCardProps, 'quickStart' | 'onAsk' | 'onNewIn'>) {
  return (
    <div className="isl-now-text">
      <div className="isl-now-head">
        <b className="isl-now-title">All quiet</b>
      </div>
      <p className="isl-now-status">Nothing is running. Start something?</p>
      <div className="isl-now-acts">
        <button type="button" className="isl-btn" onClick={onAsk}>
          Ask Spark…
        </button>
        {quickStart && (
          <button type="button" className="isl-btn" onClick={() => onNewIn(quickStart.id)}>
            New chat in {quickStart.name}
          </button>
        )}
      </div>
    </div>
  );
}

export function NowCard(props: NowCardProps) {
  const { sessions } = props;
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [direction, setDirection] = useState<'next' | 'prev'>('next');
  const index = Math.max(
    0,
    sessions.findIndex((chat) => chat.id === pickedId),
  );
  const chat = sessions[index] ?? null;
  const state = chat ? sessionState(chat) : 'idle';
  const blobRef = useRef<HTMLSpanElement>(null);
  const opening = useRef({ chatId: chat?.id ?? null, reduced: props.reduced });
  const swipe = useRef<number | null>(null);
  const wheelAt = useRef(0);

  useLayoutEffect(() => {
    const blob = blobRef.current;
    if (blob && !opening.current.reduced) hopIn(blob, opening.current.chatId);
  }, []);

  const show = (next: number) => {
    const count = sessions.length;
    if (count < 2 || next === index) return;
    setDirection(next > index ? 'next' : 'prev');
    setPickedId(sessions[(next + count) % count]!.id);
  };

  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const start = swipe.current;
    swipe.current = null;
    if (start === null) return;
    const moved = event.clientX - start;
    if (Math.abs(moved) >= SWIPE_PX) show(index + (moved < 0 ? 1 : -1));
  };

  const onWheel = (event: WheelEvent<HTMLElement>) => {
    if (Math.abs(event.deltaX) < 12 || Math.abs(event.deltaX) < Math.abs(event.deltaY)) return;
    if (event.timeStamp - wheelAt.current < WHEEL_GAP_MS) return;
    wheelAt.current = event.timeStamp;
    show(index + (event.deltaX > 0 ? 1 : -1));
  };

  return (
    <section
      className="isl-hcard isl-now"
      aria-label={chat ? `Now: ${chat.title}` : 'Now'}
      style={{ '--i': 0 } as CSSProperties}
      onPointerDown={(event) => {
        swipe.current = event.clientX;
      }}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
    >
      <span ref={blobRef} className="isl-now-blob" data-state={state}>
        <span key={chat?.id ?? 'scout'} className="isl-now-face">
          {chat ? (
            <SessionBlob
              chat={chat}
              state={state}
              size={84}
              live={state === 'working' && !props.reduced}
              expression={sessionExpression(state, props.sleepy)}
            />
          ) : (
            <BlobScout size={64} mood={props.sleepy ? 'sleep' : null} />
          )}
        </span>
        <StateBadge state={state} />
      </span>
      <div key={chat?.id ?? 'empty'} className="isl-now-page" data-dir={direction}>
        {chat ? (
          <NowSession
            chat={chat}
            reduced={props.reduced}
            onOpenHere={props.onOpenHere}
            onOpenChat={props.onOpenChat}
          />
        ) : (
          <NowEmpty quickStart={props.quickStart} onAsk={props.onAsk} onNewIn={props.onNewIn} />
        )}
      </div>
      {sessions.length > 1 && (
        <div className="isl-dots" role="group" aria-label="Live chats">
          {sessions.map((item, at) => (
            <button
              key={item.id}
              type="button"
              aria-label={`Show ${item.title}`}
              aria-current={at === index || undefined}
              onClick={() => show(at)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
