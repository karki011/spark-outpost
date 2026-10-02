import './island.css';
import './island-views.css';
import './island-panels.css';
import './island-work.css';
import './island-peek.css';
import './island-ask.css';
import './island-menu.css';
import './island-drop.css';
import '../chat/project/project.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ConversationSummary, Project } from '@spark-outpost/contracts';
import { newDraftId } from '../api/client.ts';
import { setupApi, setupKey } from '../api/setup.ts';
import { useAppEvents } from '../app/live/use-app-events.ts';
import { companionFeed, statusText } from '../companion/companion-model.ts';
import { useThrottledAnnouncement } from '../companion/use-companion-signals.ts';
import { sparkDesktop, type IslandAction } from '../desktop/desktop-bridge.ts';
import { homeApi, homeKeys } from '../home/home-api.ts';
import { useVoice } from '../spark/use-voice.ts';
import { useReducedMotion } from '../ui/motion.ts';
import type { Decided } from './CardView.tsx';
import { islandKeys, islandApi } from './island-api.ts';
import {
  cardKey,
  isQuiet,
  islandView,
  sessionState,
  pendingCards,
  peekRow,
  rankedSessions,
  waitingCount,
  type Card,
  type Panel,
} from './island-model.ts';
import { isSleepyTime, scoutMoodFor } from './island-mood.ts';
import { hasHoverItems, type HoverGroups } from './HoverList.tsx';
import { IslandShell } from './IslandShell.tsx';
import type { QuickDraft } from './QuickChat.tsx';
import { useAttachments } from '../chat/attachments/use-attachments.ts';
import { useAddProject } from './use-add-project.ts';
import { useIslandBridge, useSparkFocus } from './use-island-bridge.ts';
import { useIslandDrop } from './use-island-drop.ts';
import { chatAgent, useIslandData } from './use-island-data.ts';
import { noteSeen, useGreeting, useMoments } from './use-island-moments.ts';
import { useThemeSync } from './use-theme-sync.ts';
import type { WorkItem } from './work-items.ts';

const NOTE_MS = 1_500;
const HOVER_OUT_MS = 450;
const MOMENT_MS = 6_000;
const WAVE_MS = 1_400;
const LIST_LIMIT = 5;
const NO_IDS: string[] = [];
const NO_SNOOZE: ReadonlySet<string> = new Set();

function useHoverIntent(delayIn: number) {
  const [hover, setHover] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onHover = useCallback(
    (inside: boolean) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setHover(inside), inside ? delayIn : HOVER_OUT_MS);
      if (inside) noteSeen();
    },
    [delayIn],
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  return [hover, onHover, setHover] as const;
}

function coreRects(island: HTMLElement | null): DOMRect[] {
  if (!island) return [];
  const scout = island.classList.contains('hang') ? island.querySelector('.isl-scout-wrap') : null;
  return [island, scout].flatMap((element) => (element ? [element.getBoundingClientRect()] : []));
}

function flatRowRects(row: HTMLElement | null): DOMRect[] {
  if (!row?.matches('[data-flat]')) return [];
  return Array.from(row.querySelectorAll('[data-shown] button'), (element) =>
    element.getBoundingClientRect(),
  );
}

export function IslandApp() {
  useThemeSync();
  useAppEvents();
  const reduced = useReducedMotion();
  const voice = useVoice();
  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get });
  const assistant = useQuery({
    queryKey: islandKeys.assistant,
    queryFn: islandApi.assistant,
    enabled: false,
    staleTime: Infinity,
  });
  const hidden = useMemo(() => new Set(assistant.data ? [assistant.data] : []), [assistant.data]);
  const data = useIslandData(hidden, NO_IDS);
  const sparkFocused = useSparkFocus();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState<Decided | null>(null);
  const [review, setReview] = useState<string | null>(null);
  const [snoozed, setSnoozed] = useState<ReadonlySet<string>>(new Set());
  const [wave, setWave] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);
  const [draftId, setDraftId] = useState(newDraftId);
  const [draft, setDraft] = useState<QuickDraft>({ text: '', projectId: undefined, level: null });
  const [followUp, setFollowUp] = useState<ConversationSummary | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const { moment, dismiss } = useMoments(data.chats, data.loaded);
  const greeting = useGreeting(voice, setup.data !== undefined);
  const running = data.chats.filter(
    (chat) =>
      !chat.archivedAt &&
      !chat.needsInput &&
      (chat.latestRun?.status === 'running' || chat.latestRun?.status === 'queued'),
  );
  const [hover, onHover, setHover] = useHoverIntent(0);
  const islandRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const attachments = useAttachments();
  const [added, setAdded] = useState<{ project: Project; signal: number } | null>(null);
  const [dropNote, setDropNote] = useState<string | null>(null);
  const beforeDrop = useRef<Panel | null>(null);
  const adder = useAddProject((project) => {
    setAdded((last) => ({ project, signal: (last?.signal ?? 0) + 1 }));
    setDraft((current) => ({ ...current, projectId: project.id }));
  });

  const cards = pendingCards(data.chats, data.approvalsByChat, snoozed);
  const allCards = pendingCards(data.chats, data.approvalsByChat, NO_SNOOZE);
  const row = peekRow(data.chats, new Set(), now);
  const view = islandView({
    note: note !== null,
    panel,
    cards: allCards,
    review,
    nudge: !sparkFocused && cards.length > 0,
    hover,
  });
  const workItems: WorkItem[] = running.slice(0, LIST_LIMIT).map((chat) => ({
    chat,
    detail: data.detailById.get(chat.id),
    agent: chatAgent(chat, data.detailById.get(chat.id)),
  }));
  const groups: HoverGroups = {
    needs: allCards.slice(0, LIST_LIMIT),
    running: workItems,
    recent: row.sessions.filter((chat) => {
      const state = sessionState(chat);
      return state === 'done' || state === 'failed';
    }),
  };
  const quiet = isQuiet(view);
  const waiting = waitingCount(data.chats, new Set());
  const feed = companionFeed(data.chats);
  const spoken = useThrottledAnnouncement(statusText(feed), true);
  const sleepy = isSleepyTime(new Date(now).getHours(), 0);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), quiet ? 60_000 : 1_000);
    return () => clearInterval(timer);
  }, [quiet]);

  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(timer);
  }, [note]);

  const momentRun = moment?.runId ?? null;
  const cardChat = view.kind === 'card' || view.kind === 'nudge' ? view.card.chat : null;
  const momentTitle = data.chats.find((candidate) => candidate.id === moment?.chatId)?.title;

  useEffect(() => {
    if (!momentRun) return;
    const timer = setTimeout(dismiss, MOMENT_MS);
    return () => clearTimeout(timer);
  }, [momentRun, dismiss]);

  const viewAnnouncement = cardChat
    ? `Spark needs you: ${cardChat.title}.`
    : moment && momentTitle
      ? `${momentTitle} ${moment.kind === 'done' ? 'is done' : 'couldn’t finish'}.`
      : '';

  const openPanel = (next: Panel) => {
    setPanel(next);
    setAnnouncement(
      next === 'quick'
        ? 'New chat composer open. Enter to send, Escape to close; your draft is kept.'
        : next === 'sessions'
          ? 'Sessions open. Type to search, arrows to move, Enter to open.'
          : 'Ask Spark open.',
    );
  };

  const closePanel = () => {
    setPanel(null);
    setReview(null);
    setSelected(null);
    setFollowUp(null);
    setHover(false);
  };

  const openChat = (id: string) => {
    closePanel();
    if (moment?.chatId === id) dismiss();
    setNote({ title: 'Opening Spark…', sub: 'The chat opens in the main window.' });
    const desktop = sparkDesktop();
    if (desktop) desktop.island.openChat(id);
    else window.open('/', '_blank', 'noopener');
  };

  const openCard = (card: Card) => {
    setReview(null);
    setSelected(card.chat.id);
    openPanel('sessions');
  };

  const command = (action: IslandAction) => {
    if (action === 'sessions') {
      if (panel === 'sessions') closePanel();
      else {
        setSelected(null);
        openPanel('sessions');
      }
      return;
    }
    if (
      !panel &&
      (view.kind === 'card' || view.kind === 'nudge') &&
      (view.card.kind === 'approval' || view.card.kind === 'force')
    ) {
      setReview(cardKey(view.card));
      setFocusSignal((value) => value + 1);
      return;
    }
    if (panel) closePanel();
    else openPanel('quick');
  };

  const geometry = useIslandBridge({
    islandRef,
    focusable: panel !== null || (focusSignal > 0 && view.kind === 'card'),
    coreRects: () => coreRects(islandRef.current),
    blobRects: () => flatRowRects(rowRef.current),
    peek: view.kind === 'peek',
    hovered: hover,
    restKey: `${row.sessions.length}:${row.more}`,
    onHover,
    onCommand: command,
    onBlur: () => {
      if (!sparkDesktop()) return;
      if (panel) closePanel();
      setFocusSignal(0);
    },
  });

  const keys = useRef<(event: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    keys.current = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && panel && ['1', '2', '3'].includes(event.key)) {
        event.preventDefault();
        openPanel((['quick', 'sessions', 'ask'] as const)[Number(event.key) - 1]!);
        return;
      }
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (panel) closePanel();
      else if (review) setReview(null);
      else if (view.kind === 'note') setNote(null);
      else if (hover) setHover(false);
      else return;
      event.preventDefault();
    };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const snooze = () => {
    if (view.kind !== 'card') return;
    setSnoozed((set) => new Set([...set, cardKey(view.card)]));
    setReview(null);
    if (!reduced) {
      setWave(true);
      setTimeout(() => setWave(false), WAVE_MS);
    }
  };

  const sessions = rankedSessions(data.chats, new Set());
  const fast = {
    waiting: feed.needs.map((item) => ({
      id: item.chat.id,
      title: item.chat.title,
      detail: item.sub,
    })),
    running: feed.running.map((item) => ({
      id: item.chat.id,
      title: item.chat.title,
      detail: item.step,
    })),
    spendToday: null as number | null,
  };
  const spend = useQuery({
    queryKey: homeKeys.spend('today'),
    queryFn: () => homeApi.spend('today'),
    enabled: panel === 'ask',
  });
  fast.spendToday = spend.data?.costUsd ?? null;

  const grab = useIslandDrop({
    islandRef,
    sceneRef,
    reduced,
    onStart: () => {
      beforeDrop.current = panel;
      setDropNote(null);
      setFollowUp(null);
      openPanel('quick');
    },
    onAbort: () => {
      if (beforeDrop.current) openPanel(beforeDrop.current);
      else closePanel();
    },
    onFiles: attachments.add,
    onFolder: adder.linkFolder,
    onNote: setDropNote,
  });

  return (
    <div className="isl-drop-root" {...grab.handlers}>
      <IslandShell
        islandRef={islandRef}
        rowRef={rowRef}
        compose={{ attachments, adder, added, note: dropNote }}
        drop={{ phase: grab.phase, item: grab.item, note: dropNote, sceneRef }}
        view={view}
        geometry={geometry}
        mood={
          wave
            ? 'happy'
            : scoutMoodFor(view, {
                waiting,
                hour: new Date(now).getHours(),
                idleMinutes: 0,
                running: running.length,
                moment,
                failed: groups.recent.some((chat) => sessionState(chat) === 'failed'),
              })
        }
        reduced={reduced}
        wave={wave}
        hover={hover}
        greeting={greeting}
        waiting={waiting}
        voice={voice}
        now={now}
        note={note}
        groups={groups}
        listing={hasHoverItems(groups)}
        detailFor={(chatId) => data.detailById.get(chatId)}
        focusSignal={focusSignal}
        sessions={sessions}
        peek={row}
        sleepy={sleepy}
        projectNames={data.projectNames}
        projects={data.projects}
        selected={selected}
        draftId={draftId}
        draft={draft}
        followUp={followUp}
        fast={fast}
        announcement={viewAnnouncement || announcement || spoken}
        onDraft={setDraft}
        onTab={openPanel}
        onSelect={setSelected}
        onOpenChat={openChat}
        onDecided={setNote}
        onLater={snooze}
        onReview={openCard}
        onScout={() => {
          if (panel) closePanel();
          else if (view.kind === 'nudge') openCard(view.card);
          else openPanel(row.sessions.length > 0 || allCards.length > 0 ? 'sessions' : 'ask');
        }}
        onPeekOpen={(id) => {
          setSelected(id);
          openPanel('sessions');
        }}
        onSent={(_id, title) => {
          setAnnouncement(`Started ${followUp ? 'a follow-up' : 'a new chat'}: ${title}.`);
          setDraftId(newDraftId());
          setDropNote(null);
          closePanel();
        }}
      />
    </div>
  );
}
