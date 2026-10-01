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

function hasCard(view: IslandView): boolean {
  return view.kind === 'card' || view.kind === 'moment' || view.kind === 'note';
}

function scoutSpot(view: IslandView, width: number, top: number): ScoutSpot {
  if (view.kind === 'peek') return { x: width / 2 - 9, y: top - 13, size: 30 };
  if (hasCard(view)) return { x: 22, y: top + 8 + 14, size: 46 };
  return { x: 10, y: Math.max(2, (top - 22) / 2), size: 22 };
}

function wingsFor(props: IslandShellProps): { left: ReactNode; right: ReactNode } {
  const { view, waiting, greeting, workItems } = props;
  switch (view.kind) {
    case 'pill':
      return {
        left: null,
        right: greeting ? (
          <span>{greeting}</span>
        ) : waiting > 0 ? (
          <>
            <span className="isl-badge">{waiting}</span>
            <span>need you</span>
          </>
        ) : (
          <span>New chat</span>
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

function keyHint(view: IslandView): ReactNode {
  switch (view.kind) {
    case 'panel':
      return view.panel === 'sessions' ? (
        <>
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> move · <Kbd>Enter</Kbd> open · <Kbd>⌘ 1</Kbd> chat · <Kbd>⌘ 3</Kbd> ask ·{' '}
          <Kbd>Esc</Kbd> back / close
        </>
      ) : (
        <>
          <Kbd>Enter</Kbd> send · <Kbd>⌘ 2</Kbd> sessions · <Kbd>⌘ 3</Kbd> ask · <Kbd>Esc</Kbd>{' '}
          close
        </>
      );
    case 'card':
      return view.card.kind === 'approval' ? (
        <>
          <Kbd>⌥ Space</Kbd> focus card · <Kbd>Y</Kbd> allow · <Kbd>N</Kbd> deny
        </>
      ) : view.card.kind === 'force' ? (
        <>
          <Kbd>⌥ Space</Kbd> focus card · <Kbd>N</Kbd> deny · hold the button to confirm
        </>
      ) : null;
    case 'moment':
    case 'overview':
      return (
        <>
          <Kbd>⌥ Space</Kbd> chat · <Kbd>⌥ ⇧ Space</Kbd> sessions · <Kbd>Esc</Kbd> close
        </>
      );
    default:
      return null;
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
  const top = geometry.top;
  const quiet = view.kind === 'peek' || view.kind === 'pill';
  const width = viewWidth(view, geometry.notchWidth);
  const hint = keyHint(view);
  const setTarget = useIslandShape(
    islandRef,
    scoutRef,
    { width, height: top, radius: 14, scout: scoutSpot(view, width, top) },
    props.reduced,
  );
  const wings = wingsFor(props);

  useLayoutEffect(() => {
    const measure = () => {
      const body = quiet ? 0 : (viewRef.current?.scrollHeight ?? 0);
      const height = top + body + (hint && !quiet ? KHINT_HEIGHT : 0);
      setTarget(
        { width, height, radius: quiet ? 14 : 22, scout: scoutSpot(view, width, top) },
        view.kind === 'peek' ? 0.62 : 0.5,
      );
    };
    measure();
    const element = viewRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [view, width, top, quiet, hint, setTarget]);

  const classes = [
    'isl',
    view.kind === 'peek' ? 'peek' : '',
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
            '--gap': `${geometry.notch && geometry.docked ? geometry.notchWidth : 0}px`,
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
              <span className="isl-wr">{wings.right}</span>
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
        style={{ '--top': `${top}px` } as CSSProperties}
      >
        <PeekRow
          sessions={props.peek.sessions}
          more={props.peek.more}
          shown={quiet}
          sleepy={props.sleepy}
          onOpen={props.onPeekOpen}
          onMore={() => props.onTab('sessions')}
        />
      </div>
    </div>
  );
}
