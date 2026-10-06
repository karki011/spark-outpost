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
import { OUTLINE_MARK_LABELS, chatOutline, type OutlineEntry } from './outline-model.ts';
import { scrollToShow, tickAfterKey, tickReach } from './tick-model.ts';
import { useActiveAnchor } from './use-active-turn.ts';

interface Preview {
  id: string;
  top: number;
}

function scrollToAnchor(anchor: string): boolean {
  const target = document.getElementById(anchor);
  if (!target) return false;
  target.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  target.closest<HTMLElement>('section[data-turn]')?.focus({ preventScroll: true });
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
  const { messages, runs, approvals, plans, memberMessages, orchestrations } = detail;
  return useMemo(
    () =>
      chatOutline(
        { messages, runs, approvals, plans, memberMessages, orchestrations },
        {
          changedRunIds: new Set(
            (changedRuns ?? [])
              .filter((run) => run.files > 0 && !run.revertedAt)
              .map((run) => run.runId),
          ),
          prUrls: (watched ?? []).map((entry) => entry.url),
        },
      ),
    [messages, runs, approvals, plans, memberMessages, orchestrations, changedRuns, watched],
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
  const { active, jumped } = useActiveAnchor(
    scroller,
    entries.map((entry) => entry.anchor),
  );
  const activeIndex = entries.findIndex((entry) => entry.anchor === active);
  const tabStop = activeIndex < 0 ? 0 : activeIndex;
  const shown = preview ? entries.find((entry) => entry.id === preview.id) : undefined;

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

  const show = (id: string, tick: HTMLElement) => {
    const list = strip.current;
    const row = tick.parentElement;
    if (!list || !row) return;
    setPreview({
      id,
      top: list.offsetTop + row.offsetTop - list.scrollTop + row.offsetHeight / 2,
    });
  };
  const jump = (entry: OutlineEntry) => {
    setPreview(null);
    if (scrollToAnchor(entry.anchor)) jumped(entry.anchor);
  };
  const press = (entry: OutlineEntry, tick: HTMLElement) => {
    if (touching.current && preview?.id !== entry.id) show(entry.id, tick);
    else jump(entry);
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
            <li key={entry.id}>
              <button
                type="button"
                className="oticks-tick"
                aria-label={tickName(entry)}
                aria-current={index === activeIndex ? 'location' : undefined}
                aria-describedby={preview?.id === entry.id ? cardId : undefined}
                data-reach={tickReach(index, activeIndex) ?? undefined}
                data-tone={tickTone(entry)}
                tabIndex={index === tabStop ? 0 : -1}
                onPointerDown={notePointer}
                onPointerEnter={(event) => {
                  if (event.pointerType === 'mouse') show(entry.id, event.currentTarget);
                }}
                onFocus={(event) => {
                  if (!touching.current) show(entry.id, event.currentTarget);
                }}
                onKeyDown={(event) => moveFocus(event, index)}
                onClick={(event) => press(entry, event.currentTarget)}
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
            onClick={() => jump(shown)}
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
