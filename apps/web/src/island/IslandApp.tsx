import './island.css';
import './island-views.css';
import './island-panels.css';
import './island-work.css';
import './island-peek.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { newDraftId } from '../api/client.ts';
import { setupApi, setupKey } from '../api/setup.ts';
import { useAppEvents } from '../app/live/use-app-events.ts';
import { companionFeed, statusText } from '../companion/companion-model.ts';
import { useThrottledAnnouncement } from '../companion/use-companion-signals.ts';
import { sparkDesktop, type IslandAction } from '../desktop/desktop-bridge.ts';
import { useCompanionStatus } from '../desktop/use-companion-status.ts';
import { homeApi, homeKeys } from '../home/home-api.ts';
import { useVoice } from '../spark/use-voice.ts';
import { useReducedMotion } from '../ui/motion.ts';
import type { Decided } from './CardView.tsx';
import { islandKeys, islandApi } from './island-api.ts';
import {
  cardKey,
  isQuiet,
  islandView,
  pendingCards,
  peekRow,
  rankedSessions,
  waitingCount,
  type Panel,
} from './island-model.ts';
import { isSleepyTime, scoutMoodFor } from './island-mood.ts';
import { IslandShell } from './IslandShell.tsx';
import type { QuickDraft } from './QuickChat.tsx';
import { useIslandBridge } from './use-island-bridge.ts';
import { chatAgent, useIslandData } from './use-island-data.ts';
import { noteSeen, useGreeting, useMoments } from './use-island-moments.ts';
import { useThemeSync } from './use-theme-sync.ts';
import type { WorkItem } from './WorkViews.tsx';

const NOTE_MS = 1_500;
const HOVER_IN_MS = 220;
const HOVER_OUT_MS = 450;
const MOMENT_MS = 8_000;
const WAVE_MS = 1_400;
const NO_IDS: string[] = [];

interface Watch {
  id: string;
  tag: string;
}

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

export function IslandApp() {
  useThemeSync();
  useAppEvents();
  const reduced = useReducedMotion();
  const status = useCompanionStatus();
  const calm = status?.calm ?? false;
  const voice = useVoice();
  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get });
  const assistant = useQuery({
    queryKey: islandKeys.assistant,
    queryFn: islandApi.assistant,
    enabled: false,
    staleTime: Infinity,
  });
  const hidden = useMemo(() => new Set(assistant.data ? [assistant.data] : []), [assistant.data]);
  const [watch, setWatch] = useState<Watch | null>(null);
  const data = useIslandData(hidden, watch ? [watch.id] : NO_IDS);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [lastPanel, setLastPanel] = useState<Panel>('quick');
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState<Decided | null>(null);
  const [snoozed, setSnoozed] = useState<ReadonlySet<string>>(new Set());
  const [wave, setWave] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);
  const [draftId, setDraftId] = useState(newDraftId);
  const [draft, setDraft] = useState<QuickDraft>({ text: '', projectId: undefined, level: null });
  const [followUp, setFollowUp] = useState<ConversationSummary | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const { moment, streak, dismiss } = useMoments(data.chats, data.loaded);
  const greeting = useGreeting(voice, setup.data !== undefined);
  const running = data.chats.filter(
    (chat) =>
      !chat.archivedAt &&
      !chat.needsInput &&
      (chat.latestRun?.status === 'running' || chat.latestRun?.status === 'queued'),
  );
  const [hover, onHover, setHover] = useHoverIntent(running.length > 0 ? HOVER_IN_MS : 0);
  const islandRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  const cards = pendingCards(data.chats, data.approvalsByChat, snoozed);
  const view = islandView({
    note: note !== null,
    panel,
    cards,
    moment,
    running: running.length,
    hover: hover || greeting !== null,
  });
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

  const momentChat = view.kind === 'moment' ? view.moment.chatId : null;
  const momentKind = view.kind === 'moment' ? view.moment.kind : null;
  const cardChat = view.kind === 'card' ? view.card.chat : null;
  const watchedId = watch?.id ?? null;
  const momentTitle = data.chats.find((candidate) => candidate.id === momentChat)?.title ?? null;

  useEffect(() => {
    if (!momentChat || hover) return;
    const timer = setTimeout(dismiss, watchedId === momentChat ? MOMENT_MS * 2 : MOMENT_MS);
    return () => clearTimeout(timer);
  }, [momentChat, hover, dismiss, watchedId]);

  const viewAnnouncement = cardChat
    ? `Spark needs you: ${cardChat.title}.`
    : momentTitle && momentKind
      ? `${momentTitle} ${momentKind === 'done' ? 'is done' : 'couldn’t finish'}.`
      : '';

  const openPanel = (next: Panel) => {
    setPanel(next);
    setLastPanel(next);
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
    setSelected(null);
    setFollowUp(null);
    setHover(false);
  };

  const openChat = (id: string) => {
    closePanel();
    setNote({ title: 'Opening Spark…', sub: 'The chat opens in the main window.' });
    const desktop = sparkDesktop();
    if (desktop) desktop.island.openChat(id);
    else window.open('/', '_blank', 'noopener');
  };

  const reply = (chat: ConversationSummary) => {
    dismiss();
    setFollowUp(chat);
    openPanel('quick');
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
      view.kind === 'card' &&
      (view.card.kind === 'approval' || view.card.kind === 'force')
    ) {
      setFocusSignal((value) => value + 1);
      return;
    }
    if (panel) closePanel();
    else openPanel(lastPanel);
  };

  const geometry = useIslandBridge({
    islandRef,
    focusable: panel !== null || (focusSignal > 0 && view.kind === 'card'),
    hitRects: () =>
      [islandRef.current, rowRef.current].flatMap((element) =>
        element ? [element.getBoundingClientRect()] : [],
      ),
    onHover,
    onCommand: command,
    onBlur: () => {
      if (panel && sparkDesktop()) closePanel();
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
      if (panel === 'sessions' && selected) setSelected(null);
      else if (panel) closePanel();
      else if (view.kind === 'moment') dismiss();
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
    if (!calm && !reduced) {
      setWave(true);
      setTimeout(() => setWave(false), WAVE_MS);
    }
  };

  const workItems: WorkItem[] = running.slice(0, 4).map((chat) => ({
    chat,
    detail: data.detailById.get(chat.id),
    agent: chatAgent(chat, data.detailById.get(chat.id)),
  }));
  const itemFor = (chatId: string): WorkItem | null => {
    const chat = data.chats.find((candidate) => candidate.id === chatId);
    return chat
      ? {
          chat,
          detail: data.detailById.get(chatId),
          agent: chatAgent(chat, data.detailById.get(chatId)),
        }
      : null;
  };
  const sessions = rankedSessions(data.chats, new Set());
  const row = peekRow(data.chats, new Set(), now);
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

  return (
    <IslandShell
      islandRef={islandRef}
      rowRef={rowRef}
      view={view}
      geometry={geometry}
      mood={
        wave
          ? 'happy'
          : scoutMoodFor(view, {
              waiting: snoozed.size > 0 ? waiting : 0,
              hour: new Date(now).getHours(),
              idleMinutes: 0,
            })
      }
      reduced={reduced}
      calm={calm}
      wave={wave}
      hover={hover}
      greeting={greeting}
      waiting={waiting}
      snoozedWaiting={snoozed.size > 0 ? waiting : 0}
      voice={voice}
      now={now}
      note={note}
      workItems={workItems}
      itemFor={itemFor}
      watch={watch}
      streak={streak}
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
      onReply={reply}
      onDecided={setNote}
      onLater={snooze}
      onScout={() => {
        if (panel) closePanel();
        else openPanel(waiting > 0 && snoozed.size > 0 ? 'sessions' : lastPanel);
      }}
      onPeekOpen={(id) => {
        setSelected(id);
        openPanel('sessions');
      }}
      onSent={(id, title, project) => {
        setWatch({
          id,
          tag: `${followUp ? 'Follow-up' : 'New chat'} · ${project ?? 'No project'}`,
        });
        setAnnouncement(`Started ${followUp ? 'a follow-up' : 'a new chat'}: ${title}.`);
        setDraftId(newDraftId());
        closePanel();
      }}
    />
  );
}
