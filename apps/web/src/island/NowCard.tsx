import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ConversationDetail, ConversationSummary } from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import { BlobScout } from '../brand/BlobScout.tsx';
import { rowState } from '../conversations/row-state.ts';
import { ExternalLinkIcon } from '../ui/icons.tsx';
import { ActivityLog } from './ActivityLog.tsx';
import { DiffPeek, type PeekTarget } from './DiffPeek.tsx';
import { activityLines, runActivity, stepCount, withChanges } from './home-model.ts';
import { hopIn } from './home-motion.ts';
import { sessionState, type SessionState } from './island-model.ts';
import { sessionExpression } from './island-mood.ts';
import { RunDots } from './island-parts.tsx';
import { SessionBlob } from './SessionBlob.tsx';
import { chatAgent } from './use-island-data.ts';
import { useRunChanges } from './use-run-changes.ts';

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
  onOpenChat: (id: string, runId?: string) => void;
  onAsk: () => void;
  onNewIn: (projectId: string) => void;
}

function taskOf(detail: ConversationDetail | undefined, runIds: readonly string[]): string | null {
  if (!detail) return null;
  return detail.tasks.find((task) => runIds.some((id) => task.runIds.includes(id)))?.id ?? null;
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

function OpenButton({
  chat,
  onOpenHere,
  onOpenChat,
}: Pick<SessionProps, 'chat' | 'onOpenHere' | 'onOpenChat'>) {
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
  onPeek: (target: PeekTarget) => void;
}

function NowSession({ chat, reduced, onOpenHere, onOpenChat, onPeek }: SessionProps) {
  const detail = useQuery({
    queryKey: queryKeys.conversation(chat.id),
    queryFn: () => api.getConversation(chat.id),
  });
  const state = sessionState(chat);
  const live = state === 'working' || state === 'waiting';
  const activity = useMemo(() => runActivity(chat, detail.data), [chat, detail.data]);
  const plain = useMemo(() => activityLines(activity.steps, live), [activity, live]);
  const taskId = taskOf(detail.data, activity.runIds);
  const edits = plain.some((line) => line.kind === 'edit' && line.path !== null);
  const changes = useRunChanges(taskId, activity.runIds, edits);
  const lines = useMemo(
    () => withChanges(plain, activity.runIds, changes.entries),
    [plain, activity.runIds, changes.entries],
  );
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
        <ActivityLog
          lines={lines}
          reduced={reduced}
          onPeek={(change) => {
            if (taskId) onPeek({ chatId: chat.id, taskId, version: changes.version, change });
          }}
        />
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
  const [peekTarget, setPeekTarget] = useState<PeekTarget | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const index = Math.max(
    0,
    sessions.findIndex((chat) => chat.id === pickedId),
  );
  const chat = sessions[index] ?? null;
  const state = chat ? sessionState(chat) : 'idle';
  const peek = peekTarget && peekTarget.chatId === chat?.id ? peekTarget : null;
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

  const closePeek = () => {
    const path = peek?.change.path;
    setPeekTarget(null);
    requestAnimationFrame(() => {
      const section = sectionRef.current;
      const rows = [...(section?.querySelectorAll<HTMLElement>('button[data-change]') ?? [])];
      const back = rows.find((row) => row.dataset.change === path);
      (back ?? section?.querySelector<HTMLElement>('.isl-now-open'))?.focus({
        preventScroll: true,
      });
    });
  };

  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const start = swipe.current;
    swipe.current = null;
    if (start === null || peek) return;
    const moved = event.clientX - start;
    if (Math.abs(moved) >= SWIPE_PX) show(index + (moved < 0 ? 1 : -1));
  };

  const onWheel = (event: WheelEvent<HTMLElement>) => {
    if (peek) return;
    if (Math.abs(event.deltaX) < 12 || Math.abs(event.deltaX) < Math.abs(event.deltaY)) return;
    if (event.timeStamp - wheelAt.current < WHEEL_GAP_MS) return;
    wheelAt.current = event.timeStamp;
    show(index + (event.deltaX > 0 ? 1 : -1));
  };

  return (
    <section
      ref={sectionRef}
      className="isl-hcard isl-now"
      data-peek={peek ? '' : undefined}
      aria-label={chat ? `Now: ${chat.title}` : 'Now'}
      style={{ '--i': 0 } as CSSProperties}
      onPointerDown={(event) => {
        swipe.current = event.clientX;
      }}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
    >
      {peek ? (
        <DiffPeek target={peek} onBack={closePeek} onOpenChat={props.onOpenChat} />
      ) : (
        <>
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
                onPeek={setPeekTarget}
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
        </>
      )}
    </section>
  );
}
