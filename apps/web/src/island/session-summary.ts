import type {
  AgentModeOption,
  ConversationDetail,
  ConversationSummary,
} from '@spark-outpost/contracts';
import { rowState } from '../conversations/row-state.ts';
import { baseName, finishedLine } from './home-model.ts';
import type { SessionState } from './island-model.ts';

export type NoteTone = 'said' | 'wait' | 'bad' | 'plain';

export interface SessionNote {
  tone: NoteTone;
  lead: string | null;
  text: string;
}

function lastReply(
  chat: ConversationSummary,
  state: SessionState,
  detail: ConversationDetail | undefined,
): SessionNote | null {
  if (state !== 'done' && state !== 'idle') return null;
  const said = finishedLine(detail, chat.latestRun?.id);
  if (!said) return null;
  return { tone: 'said', lead: state === 'done' ? 'Finished: ' : 'Last reply: ', text: said };
}

function attentionNote(chat: ConversationSummary, state: SessionState): SessionNote | null {
  const status = rowState(chat, false).sub;
  if (state === 'waiting') {
    return { tone: 'wait', lead: 'Waiting: ', text: status || 'Needs your input' };
  }
  if (state === 'failed') {
    return { tone: 'bad', lead: null, text: status || 'Stopped with an error' };
  }
  const needsYou = state === 'done' && chat.unread ? chat.latestRun?.needsYou : null;
  return needsYou ? { tone: 'wait', lead: 'Needs you: ', text: needsYou } : null;
}

function quietWord(state: SessionState): string {
  if (state === 'working') return 'Working';
  return state === 'done' ? 'Finished' : 'Quiet';
}

export function sessionNotes(
  chat: ConversationSummary,
  state: SessionState,
  detail: ConversationDetail | undefined,
  hasLog: boolean,
): SessionNote[] {
  const notes = [attentionNote(chat, state), lastReply(chat, state, detail)].filter(
    (note) => note !== null,
  );
  if (notes.length > 0 || hasLog) return notes;
  return [{ tone: 'plain', lead: null, text: rowState(chat, false).sub || quietWord(state) }];
}

export interface SessionFacts {
  terminal: boolean;
  parts: string[];
  changedAt: string;
}

function known(parts: readonly (string | null | undefined)[]): string[] {
  return parts.flatMap((part) => (part?.trim() ? [part.trim()] : []));
}

export function sessionFacts(
  chat: ConversationSummary,
  detail: ConversationDetail | undefined,
  projectNames: ReadonlyMap<string, string>,
  modes: readonly AgentModeOption[],
  agent: string | null = null,
): SessionFacts {
  const project = chat.projectIds.map((id) => projectNames.get(id)).find(Boolean);
  const session = chat.sessionType === 'terminal' ? chat.terminal : null;
  if (!session) {
    return {
      terminal: false,
      parts: known([agent, project, chat.branch]),
      changedAt: chat.updatedAt,
    };
  }
  const mode = modes.find((option) => option.id === detail?.settings.agentMode)?.label;
  const changedAt = session.updatedAt > chat.updatedAt ? session.updatedAt : chat.updatedAt;
  return { terminal: true, parts: known([agent, mode, baseName(session.cwd)]), changedAt };
}

export function showsFacts(state: SessionState, hasLog: boolean): boolean {
  return state !== 'working' || !hasLog;
}

export function pagerLabel(index: number, count: number): string {
  return `${index + 1} of ${count}`;
}
