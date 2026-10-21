import './island.css';
import './island-views.css';
import './island-panels.css';
import './island-peek.css';
import './island-peek-state.css';
import './island-ask.css';
import './island-menu.css';
import './island-drop.css';
import './island-motion.css';
import './island-bar.css';
import './island-home.css';
import './island-code.css';
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
import type { Decided } from './use-decide.ts';
import { islandKeys, islandApi } from './island-api.ts';
import {
  hoverOpensHome,
  islandView,
  sessionState,
  quickShortcutTarget,
  type Card,
  type Panel,
} from './island-model.ts';
import { isSleepyTime, scoutMoodFor } from './island-mood.ts';
import { useChimes, useIslandSound } from './island-sound.ts';
import { useAutoExpandSetting, useIslandSize } from './island-size.ts';
import { opensByItself, useAutoExpand } from './auto-expand.ts';
import { IslandShell } from './IslandShell.tsx';
import type { FollowUp, QuickDraft } from './QuickChat.tsx';
import { useAttachments } from '../chat/attachments/use-attachments.ts';
import { useAddProject } from './use-add-project.ts';
import { useIslandBridge, useSparkFocus } from './use-island-bridge.ts';
import { useIslandDrop } from './use-island-drop.ts';
import { coreRects, lineRects, minuteOf, useHoverIntent } from './island-hover.ts';
import { useIslandKeys } from './use-island-keys.ts';
import { soonMeeting } from './home-model.ts';
import { stripHasContent, type StripData } from './RestStrip.tsx';
import { useAskSession } from './use-ask-session.ts';
import { useIslandData } from './use-island-data.ts';
import { useIslandAttention } from './use-island-attention.ts';
import { islandViewedChat, useIslandViewing } from './use-island-viewing.ts';
import { PANEL_ANNOUNCEMENTS } from './panel-announcements.ts';
import { useGreeting, useMoments } from './use-island-moments.ts';
import { useThemeSync } from './use-theme-sync.ts';
import { useAssistantInbox } from './ask-assistant.ts';
import { SpeechSeedContext } from '../voice/speech-seed.tsx';
import { useSpeechIsland } from '../voice/use-speech-island.ts';

const NOTE_MS = 1_500;
const MINUTE_MS = 60_000;
const WAVE_MS = 1_400;
const NO_IDS: string[] = [];
const IN_PLACE = '[data-in-place]';
type Opener = 'hover' | 'user';

function isRunningChat(chat: ConversationSummary): boolean {
  return !chat.archivedAt && sessionState(chat) === 'working';
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
  useChatListAttentionReport();
  const sparkFocused = useSparkFocus();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [opener, setOpener] = useState<Opener>('user');
  const [note, setNote] = useState<Decided | null>(null);
  const [review, setReview] = useState<string | null>(null);
  const [selfOpened, setSelfOpened] = useState<string | null>(null);
  const [menuBarBusy, setMenuBarBusy] = useState(false);
  const [wave, setWave] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);
  const [draftId, setDraftId] = useState(newDraftId);
  const [draft, setDraft] = useState<QuickDraft>({ text: '', projectId: undefined, level: null });
  const [followUp, setFollowUp] = useState<FollowUp | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [now, setNow] = useState(() => minuteOf(Date.now()));
  const { moment, text: momentText, dismiss } = useMoments(data.chats, data.loaded);
  const greeting = useGreeting(voice, setup.data !== undefined);
  const running = useMemo(() => data.chats.filter(isRunningChat), [data.chats]);
  const settleHover = useRef<(inside: boolean) => void>(() => undefined);
  const [hover, onHover, cancelHoverOpen] = useHoverIntent(settleHover);
  const islandRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const attachments = useAttachments();
  const [added, setAdded] = useState<{ project: Project; signal: number } | null>(null);
  const [dropNote, setDropNote] = useState<string | null>(null);
  const beforeDrop = useRef<Panel | null>(null);
  const adder = useAddProject((project) => {
    setAdded((last) => ({ project, signal: (last?.signal ?? 0) + 1 }));
    setDraft((current) => ({ ...current, projectId: project.id }));
  });

  const openPanel = (next: Panel, by: Opener = 'user') => {
    setPanel(next);
    setOpener(by);
    setAnnouncement(PANEL_ANNOUNCEMENTS[next]);
  };

  const attention = useIslandAttention(data.chats, data.approvalsByChat);
  const { cards, fresh, allCards } = attention;
  const askInbox = useAssistantInbox();
  const islandChatId = islandViewedChat({ review, selfOpened, focusSignal });
  useIslandViewing({
    openChatId: islandChatId,
    chats: data.chats,
    moment,
    dismissMoment: dismiss,
  });
  const size = useIslandSize();
  const waiting = fresh.length;
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
  const strip: StripData = {
    count: waiting,
    meeting: calendar.connected ? soonMeeting(calendar.upcoming, calendar.at) : null,
    working: running,
    top: fresh[0] ?? cards[0] ?? null,
  };
  const view = islandView({
    note: note !== null,
    panel,
    cards: allCards,
    review,
    strip: stripHasContent(strip) && calendar.line === null,
  });
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
  const viewAnnouncement = cardChat ? `Spark needs you: ${cardChat.title}.` : (momentText ?? '');

  const closePanel = () => {
    cancelHoverOpen();
    setPanel(null);
    setReview(null);
    setFollowUp(null);
  };

  const calendarLine = view.kind === 'peek' && !sparkFocused ? calendar.line : null;

  const openChat = (id: string | null, runId?: string) => {
    closePanel();
    if (id) attention.readChat(id);
    if (id && moment?.chatId === id) dismiss();
    const desktop = sparkDesktop();
    if (desktop) desktop.island.openChat(id, runId);
    else window.open('/', '_blank', 'noopener');
  };

  const reviewCard = (chatId: string) => {
    closePanel();
    setReview(chatId);
    setFocusSignal((value) => value + 1);
  };

  const replyTo = (chat: FollowUp) => {
    setFollowUp({ id: chat.id, title: chat.title });
    openPanel('quick');
  };

  const command = (action: IslandAction) => {
    if (action === 'sessions') {
      if (panel === 'home') closePanel();
      else openPanel('home');
      return;
    }
    const target = quickShortcutTarget(panel, view, cards[0] ?? null);
    if (target.kind === 'review') reviewCard(target.chatId);
    else if (target.kind === 'close') closePanel();
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
          failed: attention.items.some((item) => item.kind === 'run-failed'),
        });

  const geometry = useIslandBridge({
    islandRef,
    focusable: (panel !== null && opener === 'user') || (focusSignal > 0 && view.kind === 'card'),
    coreRects: () => coreRects(islandRef.current),
    blobRects: () => lineRects(islandRef.current),
    peek: resting,
    strip: view.kind === 'now',
    hovered: hover,
    onHover,
    onCommand: command,
    onBlur: () => {
      if (!sparkDesktop()) return;
      if (panel) closePanel();
      if (selfOpened !== null && review === selfOpened) setReview(null);
      setFocusSignal(0);
    },
    onMenuBar: setMenuBarBusy,
  });

  useIslandKeys({
    panel,
    openPanel,
    openSpark: () => openChat(null),
    escape: () => {
      if (panel) closePanel();
      else if (review) setReview(null);
      else if (view.kind === 'note') setNote(null);
      else return false;
      return true;
    },
  });

  const pin = (event: SyntheticEvent) => {
    setSelfOpened(null);
    const target = event.target as Element;
    if (target.closest?.(IN_PLACE)) return;
    if (panel && opener === 'hover' && event.target !== event.currentTarget) setOpener('user');
  };

  const snooze = () => {
    if (view.kind !== 'card') return;
    attention.setAside(view.card);
    setReview(null);
    if (!reduced) {
      setWave(true);
      setTimeout(() => setWave(false), WAVE_MS);
    }
  };

  useChimes(sound?.on ?? false, attention.alerts, moment, attention.viewed, calendar.hold);
  const desktop = sparkDesktop();
  const openSettings = (target: IslandSettingsTarget) => {
    closePanel();
    desktop?.island.openSettings?.(target);
  };
  const settingsReady = typeof desktop?.island.openSettings === 'function';
  const home = {
    chats: data.chats,
    cards,
    aside: attention.aside,
    seen: attention.seen,
    details: data.detailById,
    projectNames: data.projectNames,
    ask: askInbox,
    onLater: attention.setAside,
    onReview: (card: Card) => {
      attention.read(card);
      reviewCard(card.chat.id);
    },
    onDecided: (card: Card, decided: Decided) => {
      attention.handled(card);
      setAnnouncement(`${decided.title}. ${decided.sub}`);
    },
    onConnectors: settingsReady ? () => openSettings('connectors') : null,
  };
  const sparks = {
    onOpenHere: replyTo,
    onMakeSpark: settingsReady ? () => openSettings('spark-new') : null,
    onEditSpark: settingsReady ? (id: string) => openSettings(`spark-edit:${id}`) : null,
  };
  const askSession = useAskSession();
  const speechIsland = useSpeechIsland({
    chats: data.chats,
    projects: data.projects,
    panel,
    openPanel,
    replyTo,
    openChat,
  });

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
      setFollowUp(panel === 'quick' ? followUp : null);
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
    idle: opensByItself(view, {
      sparkFocused,
      dragging: grab.phase !== 'idle',
      menuBarBusy,
    }),
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
        if (grab.phase === 'idle' && hoverOpensHome(view)) openPanel('home', 'hover');
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
          asking={fresh.length}
          setAside={attention.aside.length}
          calendar={calendar}
          calendarLine={calendarLine}
          voice={voice}
          now={now}
          note={note}
          detailFor={(chatId) => data.detailById.get(chatId)}
          focusSignal={focusSignal}
          home={home}
          strip={strip}
          sparks={sparks}
          bar={{
            sound,
            onSettings: settingsReady ? () => openSettings('island') : null,
            onOpenSpark: () => openChat(null),
          }}
          counts={{
            waiting: fresh.length,
            running: running.length,
          }}
          sleepy={sleepy}
          projects={data.projects}
          draftId={draftId}
          draft={draft}
          followUp={followUp}
          askSession={askSession}
          announcement={viewAnnouncement || announcement || spoken}
          onDraft={setDraft}
          onTab={openPanel}
          onOpenChat={openChat}
          onDecided={(decided) => {
            if (view.kind === 'card') attention.handled(view.card);
            setNote(decided);
          }}
          onLater={snooze}
          onReview={(card) => reviewCard(card.chat.id)}
          onReviewChat={reviewCard}
          onScout={() => {
            if (panel) closePanel();
            else openPanel('home');
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
