import { rank, type Matched, type Named } from './fuzzy.ts';
import { dropWakeWord, keyForm, ticketKey, tokens } from './normalise.ts';
import { matchTemplate, parseTemplate, type Captures, type Template } from './templates.ts';

export interface ProjectRef {
  id: string;
  name: string;
  folder: string | null;
}

export interface ChatRef {
  id: string;
  title: string;
}

export interface TicketRef {
  source: string;
  key: string;
  title: string | null;
  known: boolean;
}

export interface SpeechLists {
  projects: readonly ProjectRef[];
  chats: readonly ChatRef[];
  tickets: readonly { source: string; key: string; title: string }[];
}

export type FastQuestion = 'needs' | 'running' | 'spend' | 'tickets' | 'ticket_status';

export type OpenTarget = { kind: 'chat'; chat: ChatRef } | { kind: 'ticket'; ticket: TicketRef };

export type Command =
  | { intent: 'start_chat'; project: Matched<ProjectRef>; ticket: TicketRef | null; task: string }
  | { intent: 'open'; target: Matched<OpenTarget> }
  | { intent: 'ask_fast'; question: FastQuestion; ticket: TicketRef | null }
  | { intent: 'reply'; chat: Matched<ChatRef>; text: string }
  | { intent: 'none'; text: string };

export type Confirmation = { answer: 'yes' } | { answer: 'no' } | { answer: 'pick'; index: number };

type Intent = Command['intent'];

const TEMPLATES: readonly { intent: Intent; question?: FastQuestion; source: string }[] = [
  { intent: 'ask_fast', question: 'needs', source: '(who|what) needs me [now]' },
  { intent: 'ask_fast', question: 'needs', source: 'does (anyone|anything) need me' },
  { intent: 'ask_fast', question: 'running', source: '(whats|what is) running [now]' },
  { intent: 'ask_fast', question: 'spend', source: '(what|how much) did i spend [today]' },
  { intent: 'ask_fast', question: 'tickets', source: 'what tickets do i have [pending]' },
  { intent: 'ask_fast', question: 'tickets', source: '(what are|show me) my [pending] tickets' },
  {
    intent: 'ask_fast',
    question: 'ticket_status',
    source: '((whats|what is) the status of|hows|how is) [ticket] {ticket} [going]',
  },
  {
    intent: 'start_chat',
    source:
      '(start|new|create) [a] [new] chat (in|on|for|and) [the] [project] {project} [(for|about) [ticket] {ticket}] [(to|and|that)] {text}',
  },
  {
    intent: 'start_chat',
    source:
      '(start|new|create) [a] [new] chat (in|on|for|and) [the] [project] {project} [(for|about) [ticket] {ticket}]',
  },
  {
    intent: 'start_chat',
    source: 'work on [ticket] {ticket} (in|on) [the] [project] {project} [{text}]',
  },
  { intent: 'open', source: '(open|show [me]|find|go to) [the] {chat} [chat]' },
  { intent: 'open', source: '(open|show [me]|find|go to) [the] [ticket] {ticket} [chat]' },
  { intent: 'reply', source: '(reply|respond) to [the] {chat} [chat] [saying] {text}' },
];

const COMPILED: readonly { intent: Intent; question?: FastQuestion; template: Template }[] =
  TEMPLATES.map((entry) => ({ ...entry, template: parseTemplate(entry.source) }));

const CONFIRM: readonly { answer: Confirmation; template: Template }[] = [
  {
    answer: { answer: 'yes' },
    template: parseTemplate('(yes|yeah|yep|sure|send [it]|open [it]|do it|go [ahead])'),
  },
  { answer: { answer: 'no' }, template: parseTemplate('(no|nope|cancel|stop|never mind)') },
  { answer: { answer: 'pick', index: 0 }, template: parseTemplate('[the] (first|1) [one]') },
  { answer: { answer: 'pick', index: 1 }, template: parseTemplate('[the] (second|2) [one]') },
  { answer: { answer: 'pick', index: 2 }, template: parseTemplate('[the] (third|3) [one]') },
];

function projectNames(project: ProjectRef): string[] {
  const folder = project.folder?.split('/').filter(Boolean).at(-1);
  return folder && folder !== project.name ? [project.name, folder] : [project.name];
}

function findTicket(heard: string[], lists: SpeechLists): TicketRef | null {
  const key = ticketKey(heard.join(' '));
  if (!key) return null;
  const known = lists.tickets.find((ticket) => keyForm(ticket.key) === keyForm(key));
  if (known) return { source: known.source, key: known.key, title: known.title, known: true };
  const source = lists.tickets.find((ticket) => ticket.key.split('-')[0] === key.split('-')[0]);
  return { source: source?.source ?? 'jira', key, title: null, known: false };
}

function spoken(words: string[] | undefined): string {
  return (words ?? []).join(' ');
}

interface Parsed {
  command: Command;
  score: number;
}

const CONNECTORS = new Set(['to', 'for', 'about', 'and', 'that', 'saying']);

function spanScore(words: readonly string[]): number {
  const connectors = words.filter((word) => CONNECTORS.has(word)).length;
  return words.length * 0.001 - connectors * 0.05;
}

function scoreOf(matched: Matched<unknown>): number {
  return matched.choices[0]?.score ?? 0;
}

function build(
  intent: Intent,
  question: FastQuestion | undefined,
  captures: Captures,
  lists: SpeechLists,
  original: string,
): Parsed | null {
  const ticket = captures.ticket ? findTicket(captures.ticket, lists) : null;
  if (captures.ticket && !ticket) return null;
  const ticketScore = ticket ? (ticket.known ? 1 : 0.9) : 0;
  const text = textFrom(captures.text, original);
  switch (intent) {
    case 'ask_fast':
      return { command: { intent, question: question!, ticket }, score: 1 + ticketScore };
    case 'start_chat': {
      const project = rank(
        spoken(captures.project),
        lists.projects.map((value) => ({ value, names: projectNames(value) })),
      );
      const span = spanScore(captures.project ?? []);
      return {
        command: { intent, project, ticket, task: text },
        score: 0.01 + span + scoreOf(project) + ticketScore,
      };
    }
    case 'open': {
      if (ticket) {
        const target: Matched<OpenTarget> = {
          heard: ticket.key,
          choices: [{ value: { kind: 'ticket', ticket }, score: ticketScore }],
          picked: { kind: 'ticket', ticket },
        };
        return { command: { intent, target }, score: ticketScore };
      }
      const candidates: Named<OpenTarget>[] = lists.chats.map((chat) => ({
        value: { kind: 'chat', chat },
        names: [chat.title],
      }));
      const target = rank(spoken(captures.chat), candidates);
      return { command: { intent, target }, score: 0.01 + scoreOf(target) };
    }
    case 'reply': {
      const chat = rank(
        spoken(captures.chat),
        lists.chats.map((value) => ({ value, names: [value.title] })),
      );
      return { command: { intent, chat, text }, score: 0.01 + scoreOf(chat) };
    }
    default:
      return null;
  }
}

function textFrom(words: string[] | undefined, original: string): string {
  if (!words || words.length === 0) return '';
  const wanted = words.join(' ');
  const starts = [...original.matchAll(/\S+/g)].map((match) => match.index);
  for (const start of starts) {
    const tail = original.slice(start).trim();
    if (tokens(tail).join(' ') === wanted) return tail.replace(/[.!?]+$/, '');
  }
  return wanted;
}

export function matchCommand(transcript: string, lists: SpeechLists): Command {
  const original = transcript.trim().replace(/^(hey\s+)?spark[,.!]?\s+/i, '');
  const heard = dropWakeWord(tokens(original));
  let best: Parsed | null = null;
  for (const entry of COMPILED) {
    for (const captures of matchTemplate(entry.template, heard)) {
      const parsed = build(entry.intent, entry.question, captures, lists, original);
      if (parsed && (!best || parsed.score > best.score)) best = parsed;
    }
  }
  if (best && best.score > 0) return best.command;
  return { intent: 'none', text: original.replace(/[.!?]+$/, '') };
}

export function matchConfirmation(transcript: string): Confirmation | null {
  const heard = dropWakeWord(tokens(transcript));
  for (const entry of CONFIRM) {
    if (matchTemplate(entry.template, heard).length > 0) return entry.answer;
  }
  return null;
}

export function speechHint(lists: SpeechLists): string {
  const prefixes = new Set(lists.tickets.map((ticket) => ticket.key.split('-')[0]));
  const names = [
    ...lists.projects.flatMap(projectNames),
    ...lists.chats.slice(0, 20).map((chat) => chat.title),
    ...prefixes,
  ];
  return [...new Set(names)].join(', ').slice(0, 600);
}
