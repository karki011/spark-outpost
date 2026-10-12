import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { BlobScout } from '../brand/BlobScout.tsx';
import { DiffPeek, type PeekTarget } from './DiffPeek.tsx';
import { hopIn } from './home-motion.ts';
import { sessionState } from './island-model.ts';
import { sessionExpression } from './island-mood.ts';
import { NowEmpty, StateBadge, type QuickStart } from './now-parts.tsx';
import { NowPager } from './NowPager.tsx';
import { NowSession } from './NowSession.tsx';
import { SessionBlob } from './SessionBlob.tsx';

const SWIPE_PX = 40;
const WHEEL_GAP_MS = 380;

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
          <NowPager sessions={sessions} index={index} onShow={show} />
        </>
      )}
    </section>
  );
}
