import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  ConversationSummary,
  Project,
  TicketSourceId,
  VoiceEvent,
} from '@spark-outpost/contracts';
import { ticketsFlowFrom } from '@spark-outpost/contracts';
import { projectKeys, projectsApi } from '../api/projects.ts';
import type { Panel } from '../island/island-model.ts';
import { ticketKeys, ticketsApi } from '../tickets/tickets-api.ts';
import { useTicketInbox } from '../tickets/use-ticket-inbox.ts';
import { lookedUpAnswer, ticketStatusAnswer, type InstantAnswer } from './answers.ts';
import {
  matchCommand,
  matchConfirmation,
  speechHint,
  type Command,
  type Confirmation,
  resolveTicketSource,
  type OpenTarget,
  type TicketRef,
  type SpeechLists,
} from './commands.ts';
import { desktopSpeech, useSpeechEvents, useSpeechStatus } from './speech-bridge.ts';
import {
  IDLE,
  nextPurpose,
  speechReducer,
  type SpeechResult,
  type SpeechState,
} from './speech-machine.ts';
import type { SpeechSeed, SpeechSeeds } from './speech-seed.tsx';

const CHAT_LIMIT = 200;
const PROJECTS_WAIT_MS = 500;

export interface SpeechIslandOptions {
  chats: readonly ConversationSummary[];
  projects: readonly Project[];
  panel: Panel | null;
  openPanel(panel: Panel): void;
  replyTo(chat: ConversationSummary): void;
  openChat(id: string): void;
}

export type ScreenChoice = { label: string; detail: string | null };

export interface SpeechScreenModel {
  state: SpeechState;
  shown: SpeechResult | null;
  choices: ScreenChoice[];
  selected: number;
  onSelect(index: number): void;
  onConfirm(index?: number): void;
  onStop(): void;
  onOpenSettings(): void;
  keepsPanel: boolean;
}

function projectRefs(projects: readonly Project[]): SpeechLists['projects'] {
  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    folder: project.rootPath,
  }));
}

function useLists(
  chats: readonly ConversationSummary[],
  projects: readonly Project[],
): SpeechLists {
  const { connected, connections, inbox } = useTicketInbox();
  const tickets = connected ? inbox.data?.tickets : undefined;
  const sources = connections.data?.connections;
  return useMemo(
    () => ({
      projects: projectRefs(projects),
      chats: chats
        .filter((chat) => !chat.archivedAt)
        .slice(0, CHAT_LIMIT)
        .map((chat) => ({ id: chat.id, title: chat.title })),
      tickets: (tickets ?? []).map((ticket) => ({
        source: ticket.source,
        key: ticket.key,
        title: ticket.title,
      })),
      sources: (sources ?? []).filter(ticketsFlowFrom).map((entry) => entry.source),
    }),
    [chats, projects, tickets, sources],
  );
}

function choicesFor(command: Command): ScreenChoice[] {
  switch (command.intent) {
    case 'start_chat':
      return command.project.choices.map((entry) => ({ label: entry.value.name, detail: null }));
    case 'reply':
      return command.chat.choices.map((entry) => ({ label: entry.value.title, detail: null }));
    case 'open':
      return command.target.choices.map((entry) => targetChoice(entry.value));
    default:
      return [];
  }
}

function targetChoice(target: OpenTarget): ScreenChoice {
  if (target.kind === 'chat') return { label: target.chat.title, detail: 'Chat' };
  return { label: target.ticket.key, detail: target.ticket.title };
}

function pickedIndex(command: Command): number {
  if (command.intent === 'start_chat')
    return Math.max(
      0,
      command.project.choices.findIndex((entry) => entry.value === command.project.picked),
    );
  if (command.intent === 'reply')
    return Math.max(
      0,
      command.chat.choices.findIndex((entry) => entry.value === command.chat.picked),
    );
  if (command.intent === 'open')
    return Math.max(
      0,
      command.target.choices.findIndex((entry) => entry.value === command.target.picked),
    );
  return 0;
}

export function useSpeechIsland(options: SpeechIslandOptions) {
  const speech = desktopSpeech();
  const status = useSpeechStatus();
  const queryClient = useQueryClient();
  const lists = useLists(options.chats, options.projects);
  const [state, dispatch] = useReducer(speechReducer, IDLE);
  const [seed, setSeed] = useState<SpeechSeed | null>(null);
  const [handed, setHanded] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState({ id: 0, count: 0 });
  const [selected, setSelected] = useState(0);
  const [panelSeen, setPanelSeen] = useState(options.panel);
  if (panelSeen !== options.panel) {
    setPanelSeen(options.panel);
    if (options.panel === null && !state.listen) {
      dispatch({ type: 'close' });
      setSeed(null);
      setHanded(null);
    }
  }
  const starts = useRef(0);
  const escapedStart = useRef(0);
  const freshProjects = useRef<Promise<SpeechLists['projects'] | null>>(Promise.resolve(null));
  const latest = useRef({ state, options, lists, seed, handed, selected, status });
  useEffect(() => {
    latest.current = { state, options, lists, seed, handed, selected, status };
  });

  const speak = (text: string) => {
    if (speech && latest.current.status?.settings.speakAnswers) void speech.speak(text);
  };

  const resolve = (ticket: TicketRef) =>
    resolveTicketSource(ticket, latest.current.lists.sources, async (source, key) => {
      await queryClient.fetchQuery({
        queryKey: ticketKeys.view(source as TicketSourceId, key),
        queryFn: () => ticketsApi.view(source as TicketSourceId, key),
      });
      return true;
    });

  const hand = (next: SpeechSeed) => {
    setSeed(next);
    setHanded(next.id);
  };

  const answerTicket = async (ticket: TicketRef): Promise<InstantAnswer> => {
    const ref = await resolve(ticket);
    if (ref.source === null)
      return { text: `${ref.key} isn’t in a connected ticket tracker.`, chats: [] };
    const cached = queryClient
      .getQueryData<{ tickets: { key: string }[] }>(ticketKeys.inbox)
      ?.tickets.find((ticket) => ticket.key === ref.key);
    if (cached) return ticketStatusAnswer(cached as Parameters<typeof ticketStatusAnswer>[0]);
    try {
      const source = ref.source as TicketSourceId;
      const view = await queryClient.fetchQuery({
        queryKey: ticketKeys.view(source, ref.key),
        queryFn: () => ticketsApi.view(source, ref.key),
      });
      return lookedUpAnswer(ref, view.ticket.title, view.ticket.statusName);
    } catch {
      return { text: `Spark couldn’t find ${ref.key}.`, chats: [] };
    }
  };

  const act = async (result: SpeechResult, index: number | null) => {
    const { command } = result;
    const { openPanel, replyTo, openChat } = latest.current.options;
    switch (command.intent) {
      case 'start_chat': {
        const project =
          index === null ? command.project.picked : command.project.choices[index]?.value;
        if (!project) return;
        hand({
          kind: 'quick',
          id: result.id,
          text: command.task,
          projectId: project.id,
          ticket: command.ticket ? await resolve(command.ticket) : null,
        });
        openPanel('quick');
        return;
      }
      case 'reply': {
        const chat = index === null ? command.chat.picked : command.chat.choices[index]?.value;
        if (!chat) return;
        hand({ kind: 'reply', id: result.id, chatId: chat.id, text: command.text });
        const summary = latest.current.options.chats.find((each) => each.id === chat.id);
        if (summary) replyTo(summary);
        else openChat(chat.id);
        return;
      }
      case 'open': {
        if (index === null) {
          const found = command.target.picked;
          if (found) speak(`Found ${targetChoice(found).label}. Open it?`);
          return;
        }
        const target = command.target.choices[index]?.value;
        if (!target) return;
        dispatch({ type: 'close' });
        if (target.kind === 'chat') return openChat(target.chat.id);
        const known = latest.current.lists.tickets.find(
          (ticket) => ticket.key === target.ticket.key,
        );
        const answer = await answerTicket({ ...target.ticket, known: Boolean(known) });
        hand({ kind: 'ask', id: result.id, question: `Open ${target.ticket.key}`, answer });
        openPanel('ask');
        return;
      }
      case 'none':
        hand({ kind: 'ask', id: result.id, question: command.text, answer: null });
        openPanel('ask');
    }
  };

  const confirm = (answer: Confirmation) => {
    const { state: now, handed: given, seed: current, selected: chosen } = latest.current;
    const result = now.result;
    if (!result) return;
    if (answer.answer === 'no') {
      dispatch({ type: 'close' });
      setSeed(null);
      return;
    }
    if (given === result.id) {
      const answered = current?.kind === 'ask' && current.answer !== null;
      if (answer.answer === 'yes' && current?.id === result.id && !answered)
        setConfirmed((last) => ({ id: result.id, count: last.count + 1 }));
      return;
    }
    const index = answer.answer === 'pick' ? answer.index : chosen;
    void act(result, index);
  };

  const heard = async (event: Extract<VoiceEvent, { kind: 'final' }>) => {
    const listen = latest.current.state.listen;
    if (!listen || listen.id !== event.id) return;
    const text = event.text.trim();
    const answer = listen.purpose === 'confirm' && text ? matchConfirmation(text) : null;
    if (answer || (listen.purpose === 'confirm' && !text)) {
      dispatch({ type: 'heard', id: event.id, text, command: null });
      if (answer) confirm(answer);
      return;
    }
    const projects = await freshProjects.current;
    const { state: now, lists } = latest.current;
    if (now.listen?.id !== event.id) return;
    const names = projects ? { ...lists, projects } : lists;
    const command = text ? matchCommand(text, names) : null;
    dispatch({ type: 'heard', id: event.id, text, command });
    if (!command) {
      speak('Didn’t catch that.');
      return;
    }
    const result = { id: now.results + 1, transcript: text, command };
    setSelected(pickedIndex(command));
    void act(result, null);
  };

  const refreshProjects = async (): Promise<SpeechLists['projects'] | null> => {
    const fresh = queryClient
      .fetchQuery({
        queryKey: projectKeys.all,
        queryFn: projectsApi.list,
        staleTime: 0,
        retry: false,
      })
      .catch(() => null);
    const late = new Promise<null>((resolve) => setTimeout(() => resolve(null), PROJECTS_WAIT_MS));
    const projects = await Promise.race([fresh, late]);
    return projects ? projectRefs(projects) : null;
  };

  const begin = async (file?: string) => {
    const { state: now, lists: names, options: opts } = latest.current;
    if (!speech || now.listen) return;
    const purpose = nextPurpose(now);
    starts.current += 1;
    const start = starts.current;
    dispatch({ type: 'start', purpose });
    if (purpose === 'command') {
      setSeed(null);
      setHanded(null);
      freshProjects.current = refreshProjects();
    }
    if (opts.panel === null || purpose === 'command') opts.openPanel(opts.panel ?? 'ask');
    const hint = speechHint(names);
    const answer = await (file ? speech.listen(purpose, hint, file) : speech.listen(purpose, hint));
    if (escapedStart.current === start) {
      if (answer.ok) void speech.cancel(answer.id);
      return;
    }
    dispatch(
      answer.ok ? { type: 'started', id: answer.id } : { type: 'refused', error: answer.error },
    );
  };

  useSpeechEvents((event) => {
    switch (event.kind) {
      case 'press':
        return void begin(event.file);
      case 'level':
        return dispatch({ type: 'level', id: event.id, level: event.level });
      case 'speech':
        return dispatch({ type: 'speech', id: event.id });
      case 'final':
        return void heard(event);
      case 'cancelled':
        return dispatch({ type: 'cancelled', id: event.id });
      case 'error':
        return dispatch({ type: 'failed', id: event.id, error: event.error });
      default:
        return undefined;
    }
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !speech) return;
      const { state: now } = latest.current;
      void speech.hush();
      if (!now.listen) return;
      if (now.listen.id) void speech.cancel(now.listen.id);
      else escapedStart.current = starts.current;
      dispatch({ type: 'escape' });
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [speech]);

  const shown = state.result && state.result.id !== handed ? state.result : null;
  const screenNeeded = state.listen !== null || state.notice !== null || shown !== null;
  const screen: SpeechScreenModel | null = screenNeeded
    ? {
        state,
        shown,
        choices: shown ? choicesFor(shown.command) : [],
        selected,
        onSelect: setSelected,
        onConfirm: (index) =>
          confirm(index === undefined ? { answer: 'yes' } : { answer: 'pick', index }),
        onStop: () => {
          if (!state.listen?.id || !speech) return;
          void speech.stop(state.listen.id);
          dispatch({ type: 'stopping' });
        },
        onOpenSettings: () => void speech?.openSettings('microphone'),
        keepsPanel: state.listen?.purpose === 'confirm' && shown === null,
      }
    : null;

  const seeds: SpeechSeeds = {
    seed,
    confirmed,
    speak,
  };

  return {
    screen,
    seeds,
  };
}
