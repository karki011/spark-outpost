import './island.css';
import './island-views.css';
import './island-panels.css';
import './island-work.css';
import './island-peek.css';
import './island-peek-state.css';
import './island-ask.css';
import './island-menu.css';
import './island-drop.css';
import './island-motion.css';
import './island-bar.css';
import './island-home.css';
import './island-code.css';
import './island-now.css';
import './island-rest.css';
import '../chat/project/project.css';
import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ConversationSummary, Project } from '@spark-outpost/contracts';
import { newDraftId } from '../api/client.ts';
import { setupApi, setupKey } from '../api/setup.ts';
import { useAppEvents } from '../app/live/use-app-events.ts';
import { companionFeed, statusText } from '../companion/companion-model.ts';
import { useThrottledAnnouncement } from '../companion/use-companion-signals.ts';
import {
  sparkDesktop,
  type IslandAction,
  type IslandSettingsTarget,
} from '../desktop/desktop-bridge.ts';
import { useChatListAttentionReport } from '../desktop/use-attention-report.ts';
import { useIslandCalendar } from '../calendar/use-island-calendar.ts';
import { useMeetingHop } from '../calendar/use-meeting-hop.ts';
import { useVoice } from '../spark/use-voice.ts';
import { useReducedMotion } from '../ui/motion.ts';
import type { Decided } from './CardView.tsx';
import { islandKeys, islandApi } from './island-api.ts';
import {
  hoverOpens,
  islandView,
  sessionState,
  pendingCards,
  peekRow,
  quickShortcutTarget,
  rankedSessions,
  waitingCount,
  type Card,
  type Panel,
} from './island-model.ts';
import { isSleepyTime, scoutMoodFor } from './island-mood.ts';
import { homeSessions, quickStartProject } from './home-model.ts';
import { useChimes, useIslandSound } from './island-sound.ts';
import { useAutoExpandSetting, useIslandSize } from './island-size.ts';
import { opensByItself, useAutoExpand } from './auto-expand.ts';
import { IslandShell } from './IslandShell.tsx';
import type { QuickDraft } from './QuickChat.tsx';
import { useAttachments } from '../chat/attachments/use-attachments.ts';
import { useAddProject } from './use-add-project.ts';
import { useIslandBridge, useSparkFocus } from './use-island-bridge.ts';
import { useIslandDrop } from './use-island-drop.ts';
import { coreRects, flatRowRects, lineRects, minuteOf, useHoverIntent } from './island-hover.ts';
import { restLine, type RestLine } from './island-rest-line.ts';
import { useSetAside } from './set-aside.ts';
import { useFastState } from './use-fast-state.ts';
import { useIslandData } from './use-island-data.ts';
import { islandViewedChat, useIslandViewing } from './use-island-viewing.ts';
import { PANEL_ANNOUNCEMENTS } from './panel-announcements.ts';
import { useGreeting, useMoments } from './use-island-moments.ts';
import { useThemeSync } from './use-theme-sync.ts';
import { SpeechSeedContext } from '../voice/speech-seed.tsx';
import { useSpeechIsland } from '../voice/use-speech-island.ts';

const NOTE_MS = 1_500;
const MINUTE_MS = 60_000;
const WAVE_MS = 1_400;
const NO_IDS: string[] = [];
const NO_SNOOZE: ReadonlySet<string> = new Set();
const NO_HIDDEN: ReadonlySet<string> = new Set();
const PANEL_KEYS = ['home', 'sessions', 'quick', 'ask'] as const;
type Opener = 'hover' | 'user';

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
  useChatListAttentionReport();
  const sparkFocused = useSparkFocus();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [opener, setOpener] = useState<Opener>('user');
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState<Decided | null>(null);
  const [review, setReview] = useState<string | null>(null);
  const [selfOpened, setSelfOpened] = useState<string | null>(null);
  const [wave, setWave] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);
  const [draftId, setDraftId] = useState(newDraftId);
  const [draft, setDraft] = useState<QuickDraft>({ text: '', projectId: undefined, level: null });
  const [followUp, setFollowUp] = useState<ConversationSummary | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [now, setNow] = useState(() => minuteOf(Date.now()));
  const { moment, text: momentText, dismiss } = useMoments(data.chats, data.loaded);
  const greeting = useGreeting(voice, setup.data !== undefined);
  const running = useMemo(
    () =>
      data.chats.filter(
        (chat) =>
          !chat.archivedAt &&
          !chat.needsInput &&
          (chat.latestRun?.status === 'running' || chat.latestRun?.status === 'queued'),
      ),
    [data.chats],
  );
  const settleHover = useRef<(inside: boolean) => void>(() => undefined);
  const [hover, onHover, cancelHoverOpen] = useHoverIntent(settleHover);
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

  const allCards = useMemo(
    () => pendingCards(data.chats, data.approvalsByChat, NO_SNOOZE),
    [data.chats, data.approvalsByChat],
  );
  const aside = useSetAside(allCards);
  const cards = useMemo(
    () => pendingCards(data.chats, data.approvalsByChat, aside.keys),
    [data.chats, data.approvalsByChat, aside.keys],
  );
  const islandChatId = islandViewedChat({ review, selfOpened, focusSignal, panel, selected });
  const { viewed, fresh, unviewed } = useIslandViewing({
    openChatId: islandChatId,
    chats: data.chats,
    pending: allCards,
    cards,
    moment,
    dismissMoment: dismiss,
  });
  const row = useMemo(() => peekRow(data.chats, NO_HIDDEN, now), [data.chats, now]);
  const size = useIslandSize();
  const view = islandView({
    full: size === 'full',
    hoverOnly: true,
    note: note !== null,
    panel,
    cards: allCards,
    review,
    nudge: !sparkFocused && fresh.length > 0,
  });
  const waiting = useMemo(() => waitingCount(data.chats, NO_HIDDEN), [data.chats]);
  const feed = useMemo(() => companionFeed(data.chats), [data.chats]);
  const spoken = useThrottledAnnouncement(statusText(feed), true);
  const sleepy = isSleepyTime(new Date(now).getHours(), 0);

  useEffect(() => {
    const timer = setInterval(() => setNow(minuteOf(Date.now())), MINUTE_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(timer);
  }, [note]);

  const resting = view.kind === 'peek' || view.kind === 'now';
  const cardChat = 'card' in view ? (view.card?.chat ?? null) : null;
  const line =
    view.kind === 'peek' ? restLine({ sparkFocused, cards: fresh, moment, momentText }) : null;
  const viewAnnouncement = cardChat ? `Spark needs you: ${cardChat.title}.` : (momentText ?? '');

  const openPanel = (next: Panel, by: Opener = 'user') => {
    setPanel(next);
    setOpener(by);
    setAnnouncement(PANEL_ANNOUNCEMENTS[next]);
  };

  const closePanel = () => {
    cancelHoverOpen();
    setPanel(null);
    setReview(null);
    setSelected(null);
    setFollowUp(null);
  };

  const calendar = useIslandCalendar(
    now,
    waiting,
    data.chats,
    (text) => {
      setFollowUp(null);
      setDraft((current) => ({ ...current, text }));
      openPanel('quick');
    },
    {
      open: panel === 'home',
      show: () => openPanel('home'),
      note: (title) => setNote({ title, sub: '' }),
    },
  );
  const calendarLine = view.kind === 'peek' && !sparkFocused && !line ? calendar.line : null;

  const openChat = (id: string, runId?: string) => {
    closePanel();
    if (moment?.chatId === id) dismiss();
    setNote({ title: 'Opening Spark…', sub: 'The chat opens in the main window.' });
    const desktop = sparkDesktop();
    if (desktop) desktop.island.openChat(id, runId);
    else window.open('/', '_blank', 'noopener');
  };

  const openCard = (card: Card, by: Opener = 'user') => {
    setReview(null);
    setSelected(card.chat.id);
    openPanel('sessions', by);
  };

  const openLine = (shown: RestLine) => {
    if (shown.card) {
      setReview(shown.chatId);
      setFocusSignal((value) => value + 1);
      return;
    }
    dismiss();
    setSelected(shown.chatId);
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
    const target = quickShortcutTarget(panel, view, cards[0] ?? null);
    if (target.kind === 'review') {
      setReview(target.chatId);
      setFocusSignal((value) => value + 1);
    } else if (target.kind === 'close') closePanel();
    else openPanel('quick');
  };

  const sound = useIslandSound();
  const hopping = useMeetingHop(calendar.hopKeys, sound?.on ?? false, calendar.hold.held);
  const mood =
    wave || hopping
      ? 'happy'
      : scoutMoodFor(view, {
          waiting: cards.length,
          hour: new Date(now).getHours(),
          idleMinutes: 0,
          running: running.length,
          moment,
          failed: row.sessions.some((chat) => sessionState(chat) === 'failed'),
        });

  const geometry = useIslandBridge({
    islandRef,
    focusable: (panel !== null && opener === 'user') || (focusSignal > 0 && view.kind === 'card'),
    coreRects: () => coreRects(islandRef.current),
    blobRects: () => [...flatRowRects(rowRef.current), ...lineRects(islandRef.current)],
    peek: resting,
    hovered: hover,
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
      const slot = PANEL_KEYS[Number(event.key) - 1];
      if ((event.metaKey || event.ctrlKey) && panel && slot) {
        event.preventDefault();
        openPanel(slot);
        return;
      }
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (panel) closePanel();
      else if (review) setReview(null);
      else if (view.kind === 'note') setNote(null);
      else return;
      event.preventDefault();
    };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const pin = (event: SyntheticEvent) => {
    setSelfOpened(null);
    if (panel && opener === 'hover' && event.target !== event.currentTarget) setOpener('user');
  };

  const snooze = () => {
    if (view.kind !== 'card') return;
    aside.setAside(view.card);
    setReview(null);
    if (!reduced) {
      setWave(true);
      setTimeout(() => setWave(false), WAVE_MS);
    }
  };

  const sessions = useMemo(() => rankedSessions(data.chats, NO_HIDDEN), [data.chats]);
  useChimes(sound?.on ?? false, data.loaded ? data.chats : null, moment, viewed, calendar.hold);
  const desktop = sparkDesktop();
  const openSettings = (target: IslandSettingsTarget) => {
    closePanel();
    desktop?.island.openSettings?.(target);
  };
  const settingsReady = typeof desktop?.island.openSettings === 'function';
  const quickStart = useMemo(
    () => quickStartProject(data.chats, data.projects),
    [data.chats, data.projects],
  );
  const homeChats = useMemo(() => homeSessions(data.chats), [data.chats]);
  const home = {
    sessions: homeChats,
    chats: data.chats,
    cards: unviewed,
    quickStart: quickStart ? { id: quickStart.id, name: quickStart.name } : null,
    onOpenHere: (id: string) => {
      setSelected(id);
      openPanel('sessions');
    },
    onNewIn: (projectId: string | null) => {
      setFollowUp(null);
      setDraft((current) => ({ ...current, projectId }));
      openPanel('quick');
    },
    onMakeSpark: settingsReady ? () => openSettings('spark-new') : null,
    onConnectors: settingsReady ? () => openSettings('connectors') : null,
    onEditSpark: settingsReady ? (id: string) => openSettings(`spark-edit:${id}`) : null,
  };
  const fast = useFastState(feed, panel === 'ask');
  const speechIsland = useSpeechIsland({
    chats: data.chats,
    projects: data.projects,
    fast,
    panel,
    openPanel,
    selectChat: setSelected,
    openChat,
  });

  const openChatHere =
    panel === 'sessions' ? (data.chats.find((chat) => chat.id === selected) ?? null) : null;
  const backFromDrop = () => {
    if (beforeDrop.current) openPanel(beforeDrop.current);
    else closePanel();
  };
  const { grab, handlers: dropHandlers } = useIslandDrop({
    islandRef,
    sceneRef,
    onStart: () => {
      beforeDrop.current = panel;
      setDropNote(null);
      setFollowUp(openChatHere);
      openPanel('quick');
    },
    onAbort: backFromDrop,
    onFiles: attachments.add,
    onFolders: async (folders, use) => {
      await Promise.all(folders.map(adder.linkFolderAsync));
      if (use === 'chat') setFollowUp(null);
    },
    onDone: (outcome) => {
      if (outcome === 'project') backFromDrop();
    },
    onNote: setDropNote,
  });

  useAutoExpand({
    enabled: useAutoExpandSetting(),
    idle: opensByItself(view, { sparkFocused, dragging: grab.phase !== 'idle' }),
    cards: fresh,
    pending: allCards,
    onExpand: (card) => {
      setSelfOpened(card.chat.id);
      setFocusSignal(0);
      setReview(card.chat.id);
    },
  });

  useEffect(() => {
    settleHover.current = (inside: boolean) => {
      if (inside) {
        if (grab.phase !== 'idle') return;
        const target = hoverOpens(view, !sparkFocused ? (fresh[0] ?? null) : null);
        if (target?.kind === 'home') openPanel('home', 'hover');
        else if (target?.kind === 'card') openCard(target.card, 'hover');
        return;
      }
      if (panel && opener === 'hover') closePanel();
    };
  });

  return (
    <div
      className="isl-drop-root"
      {...dropHandlers}
      onPointerDownCapture={pin}
      onKeyDownCapture={pin}
    >
      <SpeechSeedContext.Provider value={speechIsland.seeds}>
        <IslandShell
          islandRef={islandRef}
          speech={speechIsland.screen}
          rowRef={rowRef}
          compose={{ attachments, adder, added, note: dropNote }}
          drop={{ grab, note: dropNote, replyingTo: followUp?.title ?? null, sceneRef }}
          view={view}
          geometry={geometry}
          size={size}
          mood={mood}
          reduced={reduced}
          wave={wave}
          hover={hover}
          greeting={greeting}
          waiting={waiting}
          asking={cards.length}
          setAside={allCards.length - cards.length}
          line={line}
          calendar={calendar}
          calendarLine={calendarLine}
          voice={voice}
          now={now}
          note={note}
          detailFor={(chatId) => data.detailById.get(chatId)}
          focusSignal={focusSignal}
          sessions={sessions}
          home={home}
          bar={{ sound, onSettings: settingsReady ? () => openSettings('island') : null }}
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
          onLine={openLine}
          onScout={() => {
            if (panel) closePanel();
            else if (view.kind === 'now' && view.card) openCard(view.card);
            else openPanel('home');
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
      </SpeechSeedContext.Provider>
    </div>
  );
}
