import { useLayoutEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';
import type { ConversationSummary, Project } from '@spark-outpost/contracts';
import { BlobScout, type ScoutMood } from '../brand/BlobScout.tsx';
import { CrewBlob } from '../crew/CrewBlob.tsx';
import type { IslandGeometry } from '../desktop/desktop-bridge.ts';
import type { Voice } from '../spark/voice.ts';
import type { FastState } from './ask-fast-path.ts';
import { AskSpark } from './AskSpark.tsx';
import { CardView, type Decided } from './CardView.tsx';
import {
  viewWidth,
  type IslandView,
  type Panel,
  type PeekRow as PeekRowData,
} from './island-model.ts';
import { Kbd, RunDots } from './island-parts.tsx';
import { keyHint } from './key-hints.tsx';
import { PeekRow } from './PeekRow.tsx';
import { QuickChat, type QuickDraft } from './QuickChat.tsx';
import { Sessions } from './Sessions.tsx';
import { useIslandShape, type ScoutSpot } from './use-island-shape.ts';
import { chatAgent } from './use-island-data.ts';
import { LiveView, MomentView, OverviewView, type WorkItem } from './WorkViews.tsx';

interface ShellRefs {
  islandRef: RefObject<HTMLDivElement | null>;
  rowRef: RefObject<HTMLDivElement | null>;
}

interface IslandShellProps {
  view: IslandView;
  geometry: IslandGeometry;
  mood: ScoutMood;
  reduced: boolean;
  calm: boolean;
  wave: boolean;
  hover: boolean;
  greeting: string | null;
  waiting: number;
  snoozedWaiting: number;
  voice: Voice;
  now: number;
  note: Decided | null;
  workItems: WorkItem[];
  itemFor: (chatId: string) => WorkItem | null;
  watch: { id: string; tag: string } | null;
  streak: number;
  focusSignal: number;
  sessions: ConversationSummary[];
  peek: PeekRowData;
  sleepy: boolean;
  projectNames: ReadonlyMap<string, string>;
  projects: readonly Project[];
  selected: string | null;
  draftId: string;
  draft: QuickDraft;
  followUp: ConversationSummary | null;
  fast: FastState;
  announcement: string;
  onDraft: (draft: QuickDraft) => void;
  onTab: (panel: Panel) => void;
  onSelect: (id: string | null) => void;
  onOpenChat: (id: string) => void;
  onReply: (chat: ConversationSummary) => void;
  onDecided: (decided: Decided) => void;
  onLater: () => void;
  onScout: () => void;
  onPeekOpen: (id: string) => void;
  onSent: (id: string, title: string, project: string | null) => void;
}

const KHINT_HEIGHT = 18;
const PILL_HEIGHT = 34;
const PILL_INSET = 48;
const PILL_MIN_WIDTH = 112;
const BARE_SCOUT = 38;
const BARE_TUCK = 20;
const ROW_BLOB = 22;
const FLAT_ROW_BLOB = 28;

function hasCard(view: IslandView): boolean {
  return view.kind === 'card' || view.kind === 'moment' || view.kind === 'note';
}

function scoutSpot(view: IslandView, width: number, top: number, hang: number | null): ScoutSpot {
  if (hang !== null) return { x: width / 2 - BARE_SCOUT / 2, y: -hang, size: BARE_SCOUT };
  if (view.kind === 'peek') return { x: width / 2 - 9, y: top - 13, size: 30 };
  if (hasCard(view)) return { x: 22, y: top + 8 + 14, size: 46 };
  return { x: view.kind === 'pill' ? 14 : 10, y: Math.max(2, (top - 22) / 2), size: 22 };
}

function wingsFor(props: IslandShellProps): { left: ReactNode; right: ReactNode } {
  const { view, waiting, greeting, workItems } = props;
  switch (view.kind) {
    case 'pill':
      return {
        left: null,
        right: (
          <button
            type="button"
            className="isl-pill-btn"
            onClick={() => props.onTab(waiting > 0 ? 'sessions' : 'quick')}
          >
            {greeting ? (
              <span>{greeting}</span>
            ) : waiting > 0 ? (
              <>
                <span className="isl-badge">{waiting}</span>
                <span>need you</span>
              </>
            ) : (
              <span>New chat</span>
            )}
          </button>
        ),
      };
    case 'live': {
      const crew = workItems.flatMap((item) =>
        item.agent.crew.filter((agent) => agent.state === 'working' || agent.state === 'thinking'),
      );
      return {
        left: null,
        right:
          crew.length > 1 ? (
            <>
              <span className="isl-crew" aria-hidden="true">
                {crew.slice(0, 4).map((agent) => (
                  <span key={agent.id} className="isl-cb" title={agent.name}>
                    <CrewBlob
                      name={agent.name}
                      provider={agent.provider}
                      state={agent.state}
                      size={18}
                    />
                  </span>
                ))}
              </span>
              <span>{crew.length}</span>
            </>
          ) : (
            <>
              <RunDots />
              <span>{workItems.length}</span>
            </>
          ),
      };
    }
    case 'overview':
      return {
        left: 'Spark',
        right: (
          <>
            <RunDots />
            <span>{workItems.length} running</span>
          </>
        ),
      };
    case 'card':
      return {
        left: view.card.kind === 'question' ? 'Question' : 'Needs you',
        right:
          view.card.kind === 'force' ? (
            <>
              <span className="isl-badge bad">!</span>
              <span>Risky</span>
            </>
          ) : (
            <>
              <span className="isl-badge">{view.index}</span>
              <span>of {view.total}</span>
            </>
          ),
      };
    case 'moment':
      return {
        left:
          props.watch?.id === view.moment.chatId
            ? 'Reply'
            : view.moment.kind === 'done'
              ? 'Finished'
              : 'Couldn’t finish',
        right: (
          <span className={view.moment.kind === 'done' ? 'isl-badge ok' : 'isl-badge bad'}>
            {view.moment.kind === 'done' ? '✓' : '!'}
          </span>
        ),
      };
    case 'panel':
      return {
        left:
          view.panel === 'quick'
            ? props.followUp
              ? 'Reply'
              : 'New chat'
            : view.panel === 'sessions'
              ? 'Sessions'
              : 'Ask Spark',
        right:
          view.panel === 'sessions' && waiting > 0 ? (
            <>
              <span className="isl-badge">{waiting}</span>
              <span>need you</span>
            </>
          ) : (
            <Kbd>⌥ Space</Kbd>
          ),
      };
    default:
      return { left: null, right: null };
  }
}

function ViewBody({ props }: { props: IslandShellProps }) {
  const { view } = props;
  const focusDelay = props.reduced ? 0 : 240;
  switch (view.kind) {
    case 'note':
      return (
        <div className="isl-body">
          <div className="isl-card plain" data-wash="accent" role="status">
            <div className="isl-ttl">{props.note?.title}</div>
            <div className="isl-hint">{props.note?.sub}</div>
          </div>
        </div>
      );
    case 'panel':
      if (view.panel === 'quick') {
        return (
          <QuickChat
            draftId={props.draftId}
            draft={props.draft}
            followUp={props.followUp}
            projects={props.projects}
            waiting={props.waiting}
            focusDelay={focusDelay}
            onDraft={props.onDraft}
            onTab={props.onTab}
            onSent={props.onSent}
          />
        );
      }
      if (view.panel === 'sessions') {
        return (
          <Sessions
            chats={props.sessions}
            projectNames={props.projectNames}
            selected={props.selected}
            waiting={props.waiting}
            focusDelay={focusDelay}
            onSelect={props.onSelect}
            onTab={props.onTab}
            onOpenChat={props.onOpenChat}
            onReply={props.onReply}
          />
        );
      }
      return (
        <AskSpark
          fast={props.fast}
          waiting={props.waiting}
          focusDelay={focusDelay}
          onTab={props.onTab}
          onOpenChat={props.onOpenChat}
        />
      );
    case 'card': {
      const item = props.itemFor(view.card.chat.id);
      return (
        <div className="isl-body">
          <CardView
            card={view.card}
            index={view.index}
            total={view.total}
            agent={chatAgent(view.card.chat, item?.detail)}
            focusSignal={props.focusSignal}
            onDecided={props.onDecided}
            onOpenChat={props.onOpenChat}
            onLater={props.onLater}
          />
        </div>
      );
    }
    case 'moment':
      return (
        <div className="isl-body">
          <MomentView
            moment={view.moment}
            item={props.itemFor(view.moment.chatId)}
            voice={props.voice}
            reply={props.watch?.id === view.moment.chatId}
            streak={props.streak}
            onOpenChat={props.onOpenChat}
            onReply={props.onReply}
          />
        </div>
      );
    case 'overview':
      return (
        <div className="isl-body">
          <OverviewView
            items={props.workItems}
            voice={props.voice}
            now={props.now}
            onOpenChat={props.onOpenChat}
          />
        </div>
      );
    case 'live': {
      const tag =
        props.watch && props.workItems.some((item) => item.chat.id === props.watch?.id)
          ? props.watch.tag
          : null;
      return (
        <LiveView
          items={props.workItems}
          voice={props.voice}
          now={props.now}
          tag={tag}
          still={props.reduced}
        />
      );
    }
    default:
      return null;
  }
}

function viewKey(view: IslandView): string {
  switch (view.kind) {
    case 'panel':
      return `panel-${view.panel}`;
    case 'card':
      return `card-${view.card.approval?.id ?? view.card.chat.id}`;
    case 'moment':
      return `moment-${view.moment.runId}`;
    default:
      return view.kind;
  }
}

export function IslandShell({ islandRef, rowRef, ...props }: IslandShellProps & ShellRefs) {
  const { view, geometry } = props;
  const scoutRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const wingRef = useRef<HTMLSpanElement>(null);
  const hugsNotch = geometry.notch && geometry.docked;
  const flat = geometry.docked && !geometry.notch;
  const bare = flat && view.kind === 'peek';
  const hang = bare ? geometry.menuBar + BARE_TUCK : null;
  const top = view.kind === 'pill' ? Math.max(geometry.top, PILL_HEIGHT) : bare ? 0 : geometry.top;
  const quiet = view.kind === 'peek' || view.kind === 'pill';
  const width = bare ? BARE_SCOUT : viewWidth(view, geometry.notchWidth);
  const compactPill = view.kind === 'pill' && !hugsNotch;
  const hint = keyHint(view);
  const setTarget = useIslandShape(
    islandRef,
    scoutRef,
    { width, height: top, radius: 14, scout: scoutSpot(view, width, top, hang) },
    props.reduced,
  );
  const wings = wingsFor(props);

  useLayoutEffect(() => {
    const measure = () => {
      const body = quiet ? 0 : (viewRef.current?.scrollHeight ?? 0);
      const height = top + body + (hint && !quiet ? KHINT_HEIGHT : 0);
      const fitted = compactPill
        ? Math.max(PILL_MIN_WIDTH, PILL_INSET + (wingRef.current?.scrollWidth ?? 0))
        : width;
      setTarget(
        {
          width: fitted,
          height,
          radius: view.kind === 'pill' ? 16 : quiet ? 14 : 22,
          scout: scoutSpot(view, fitted, top, hang),
        },
        view.kind === 'peek' ? 0.62 : 0.5,
      );
    };
    measure();
    const watched = [viewRef.current, compactPill ? wingRef.current : null].filter(
      (element) => element !== null,
    );
    if (watched.length === 0 || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    watched.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [view, width, top, quiet, hint, compactPill, hang, setTarget]);

  const classes = [
    'isl',
    view.kind === 'peek' ? 'peek' : '',
    bare ? 'bare' : '',
    flat ? 'hang' : '',
    !quiet ? 'lifted' : '',
    geometry.docked ? '' : 'floating',
  ].filter(Boolean);

  return (
    <div
      className="isl-root"
      data-calm={props.calm || undefined}
      data-rm={props.reduced || undefined}
      data-rest={(quiet && !props.hover) || undefined}
    >
      <div className="sr-only" aria-live="polite">
        {props.announcement}
      </div>
      <div
        ref={islandRef}
        className={classes.join(' ')}
        role="region"
        aria-label="Spark companion"
        data-view={view.kind}
        style={
          {
            '--top': `${top}px`,
            '--bar': `${geometry.menuBar}px`,
            '--gap': `${hugsNotch ? geometry.notchWidth : 0}px`,
            '--wl': hasCard(view) ? '14px' : '40px',
          } as CSSProperties
        }
      >
        <span className="isl-ear l" aria-hidden="true" />
        <span className="isl-ear r" aria-hidden="true" />
        <div className="isl-clip">
          <div className="isl-toprow">
            <div className="isl-wing l">
              <span className="isl-wlabel">{wings.left}</span>
            </div>
            <div className="isl-gap" />
            <div className="isl-wing r">
              <span ref={wingRef} className="isl-wr">
                {wings.right}
              </span>
            </div>
          </div>
          {!quiet && (
            <div ref={viewRef} key={viewKey(view)} className="isl-view" style={{ width }}>
              <ViewBody props={props} />
            </div>
          )}
          {hint && !quiet && (
            <div className="isl-khint" aria-hidden="true">
              {hint}
            </div>
          )}
          {view.kind === 'moment' && !props.hover && (
            <span key={viewKey(view)} className="isl-closebar" aria-hidden="true" />
          )}
        </div>
        <div ref={scoutRef} className="isl-scout-wrap" data-wave={props.wave || undefined}>
          {props.snoozedWaiting > 0 && quiet && (
            <span className="isl-pbadge" aria-hidden="true">
              {props.snoozedWaiting}
            </span>
          )}
          <span className="isl-glow" data-mood={props.mood ?? 'idle'} aria-hidden="true" />
          <BlobScout mood={props.mood} size={30} lookAtPointer={quiet && !props.calm} />
          <button
            type="button"
            className="isl-scout-btn"
            aria-label={
              props.snoozedWaiting > 0
                ? `Spark: ${props.snoozedWaiting} need you. Open sessions`
                : 'Open Spark companion'
            }
            onClick={props.onScout}
          />
        </div>
      </div>
      <div
        ref={rowRef}
        className="isl-peekrow-wrap"
        data-flat={flat || undefined}
        style={{ '--top': `${top}px` } as CSSProperties}
      >
        <PeekRow
          sessions={props.peek.sessions}
          more={props.peek.more}
          shown={quiet}
          size={flat ? FLAT_ROW_BLOB : ROW_BLOB}
          sleepy={props.sleepy}
          onOpen={props.onPeekOpen}
          onMore={() => props.onTab('sessions')}
        />
      </div>
    </div>
  );
}
