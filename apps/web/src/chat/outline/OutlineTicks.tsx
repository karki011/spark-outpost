import './outline-ticks.css';
import {
  memo,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ConversationDetail } from '@spark-outpost/contracts';
import { diffApi, diffKeys } from '../../diff/diff-api.ts';
import { prefersReducedMotion } from '../../ui/motion.ts';
import { prWatchesQuery } from '../pull-request/pr-follow-up-api.ts';
import { MarkIcon } from '../rail/RailIcons.tsx';
import {
  OUTLINE_MARK_LABELS,
  chatOutline,
  turnAnchor,
  type OutlineEntry,
} from './outline-model.ts';
import { scrollToShow, tickAfterKey, tickReach } from './tick-model.ts';
import { useActiveTurn } from './use-active-turn.ts';

interface Preview {
  runId: string;
  top: number;
}

function scrollToTurn(runId: string): boolean {
  const section = document.getElementById(turnAnchor(runId));
  if (!section) return false;
  section.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  section.focus({ preventScroll: true });
  return true;
}

function useChatOutline(detail: ConversationDetail, taskId: string | null): OutlineEntry[] {
  const changes = useQuery({
    queryKey: diffKeys.summary(taskId ?? ''),
    queryFn: () => diffApi.summary(taskId ?? ''),
    enabled: taskId !== null,
  });
  const watches = useQuery(prWatchesQuery(detail.conversation.id));
  const changedRuns = changes.data?.runs;
  const watched = watches.data?.watches;
  const { messages, runs, approvals, plans } = detail;
  return useMemo(
    () =>
      chatOutline(
        { messages, runs, approvals, plans },
        {
          changedRunIds: new Set(
            (changedRuns ?? [])
              .filter((run) => run.files > 0 && !run.revertedAt)
              .map((run) => run.runId),
          ),
          prUrls: (watched ?? []).map((entry) => entry.url),
        },
      ),
    [messages, runs, approvals, plans, changedRuns, watched],
  );
}

function tickName(entry: OutlineEntry): string {
  return [entry.label, ...entry.marks.map((mark) => OUTLINE_MARK_LABELS[mark])].join(', ');
}

function tickTone(entry: OutlineEntry): string | undefined {
  if (entry.marks.includes('error')) return 'error';
  if (entry.marks.includes('approval')) return 'approval';
  return undefined;
}

interface TicksProps {
  entries: readonly OutlineEntry[];
  scroller: RefObject<HTMLElement | null>;
}

function Ticks({ entries, scroller }: TicksProps) {
  const nav = useRef<HTMLElement>(null);
  const strip = useRef<HTMLOListElement>(null);
  const touching = useRef(false);
  const cardId = useId();
  const [preview, setPreview] = useState<Preview | null>(null);
  const { active, jumped } = useActiveTurn(
    scroller,
    entries.map((entry) => entry.runId),
  );
  const activeIndex = entries.findIndex((entry) => entry.runId === active);
  const tabStop = activeIndex < 0 ? 0 : activeIndex;
  const shown = preview ? entries.find((entry) => entry.runId === preview.runId) : undefined;

  useEffect(() => {
    const list = strip.current;
    const tick = list?.children[activeIndex] as HTMLElement | undefined;
    if (!list || !tick) return;
    list.scrollTop = scrollToShow(
      { scrollTop: list.scrollTop, height: list.clientHeight },
      tick.offsetTop,
      tick.offsetHeight,
    );
  }, [activeIndex]);

  const previewing = preview !== null;
  useEffect(() => {
    if (!previewing) return;
    const dismiss = (event: globalThis.PointerEvent) => {
      if (!nav.current?.contains(event.target as Node)) setPreview(null);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [previewing]);

  const show = (runId: string, tick: HTMLElement) => {
    const list = strip.current;
    const row = tick.parentElement;
    if (!list || !row) return;
    setPreview({
      runId,
      top: list.offsetTop + row.offsetTop - list.scrollTop + row.offsetHeight / 2,
    });
  };
  const jump = (runId: string) => {
    setPreview(null);
    if (scrollToTurn(runId)) jumped(runId);
  };
  const press = (runId: string, tick: HTMLElement) => {
    if (touching.current && preview?.runId !== runId) show(runId, tick);
    else jump(runId);
  };
  const notePointer = (event: PointerEvent) => {
    touching.current = event.pointerType === 'touch';
  };
  const moveFocus = (event: KeyboardEvent, index: number) => {
    if (event.key === 'Escape') setPreview(null);
    const next = tickAfterKey(event.key, index, entries.length);
    if (next === null) return;
    event.preventDefault();
    strip.current?.children[next]?.querySelector('button')?.focus();
  };

  return (
    <div className="oticks-slot">
      <nav
        ref={nav}
        className="oticks"
        aria-label="On this chat"
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') setPreview(null);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setPreview(null);
        }}
      >
        <ol ref={strip}>
          {entries.map((entry, index) => (
            <li key={entry.runId}>
              <button
                type="button"
                className="oticks-tick"
                aria-label={tickName(entry)}
                aria-current={index === activeIndex ? 'location' : undefined}
                aria-describedby={preview?.runId === entry.runId ? cardId : undefined}
                data-reach={tickReach(index, activeIndex) ?? undefined}
                data-tone={tickTone(entry)}
                tabIndex={index === tabStop ? 0 : -1}
                onPointerDown={notePointer}
                onPointerEnter={(event) => {
                  if (event.pointerType === 'mouse') show(entry.runId, event.currentTarget);
                }}
                onFocus={(event) => {
                  if (!touching.current) show(entry.runId, event.currentTarget);
                }}
                onKeyDown={(event) => moveFocus(event, index)}
                onClick={(event) => press(entry.runId, event.currentTarget)}
              />
            </li>
          ))}
        </ol>
        {preview && shown && (
          <div
            id={cardId}
            role="tooltip"
            className="oticks-card"
            style={{ top: preview.top }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => jump(shown.runId)}
          >
            <p className="oticks-ask">{shown.label}</p>
            {shown.reply && <p className="oticks-reply">{shown.reply}</p>}
            {shown.marks.length > 0 && (
              <p className="oticks-marks">
                {shown.marks.map((mark) => (
                  <span key={mark} className={`oticks-mark ${mark}`}>
                    <MarkIcon mark={mark} />
                    {OUTLINE_MARK_LABELS[mark]}
                  </span>
                ))}
              </p>
            )}
          </div>
        )}
      </nav>
    </div>
  );
}

interface OutlineTicksProps {
  detail: ConversationDetail;
  taskId: string | null;
  scroller: RefObject<HTMLElement | null>;
}

export const OutlineTicks = memo(function OutlineTicks({
  detail,
  taskId,
  scroller,
}: OutlineTicksProps) {
  const entries = useChatOutline(detail, taskId);
  if (entries.length === 0) return null;
  return <Ticks entries={entries} scroller={scroller} />;
});
