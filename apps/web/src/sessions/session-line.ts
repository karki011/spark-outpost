import {
  friendlyStep,
  terminalWaitsAlone,
  turnCostOrigin,
  type ConversationSummary,
  type NativeTerminalTurn,
  type NativeTerminalUsage,
  type PlanProgress,
} from '@spark-outpost/contracts';
import { isRunning, rowState } from '../conversations/row-state.ts';
import { countLabel } from '../ui/count-label.ts';
import { formatCost } from '../usage/format.ts';

export interface SessionLine {
  step: string | null;
  steps: string | null;
  subagents: string | null;
  model: string | null;
  cost: string | null;
}

export type LinePart = keyof SessionLine;

const EMPTY: SessionLine = { step: null, steps: null, subagents: null, model: null, cost: null };
const ALL_PARTS: readonly LinePart[] = ['step', 'steps', 'subagents', 'model', 'cost'];
const LIVE_TURN = new Set(['queued', 'running', 'awaiting_approval']);

export function isTerminalSession(chat: ConversationSummary): boolean {
  return chat.sessionType === 'terminal' && Boolean(chat.terminal);
}

function subagentCount(turn: NativeTerminalTurn): number {
  return new Set(turn.steps.flatMap((step) => (step.agentId === null ? [] : [step.agentId]))).size;
}

function latestStep(turn: NativeTerminalTurn): string | null {
  const step = turn.steps.findLast((entry) => entry.endedAt === null) ?? turn.steps.at(-1);
  return step ? friendlyStep(step.name) : null;
}

function turnCost(turn: NativeTerminalTurn): string | null {
  if (turn.costUsd === null) return null;
  return formatCost(turn.costUsd, turnCostOrigin(turn) === 'reported' ? 'reported' : 'estimated');
}

export function shortModel(model: string | null): string | null {
  return model?.replace(/\[.*\]$/, '').trim() || null;
}

function terminalLine(chat: ConversationSummary, usage: NativeTerminalUsage | undefined) {
  const turn = usage?.turns.at(-1);
  if (!turn) return EMPTY;
  const working = isRunning(chat) && LIVE_TURN.has(turn.status);
  const agents = subagentCount(turn);
  return {
    step: working ? latestStep(turn) : null,
    steps: turn.steps.length > 0 ? countLabel(turn.steps.length, 'step') : null,
    subagents: agents > 0 ? countLabel(agents, 'sub-agent') : null,
    model: shortModel(turn.model),
    cost: turnCost(turn),
  };
}

function progressText(progress: PlanProgress | null | undefined): string | null {
  if (!progress || progress.total < 2) return null;
  const current = Math.min(progress.total, progress.done + (progress.active > 0 ? 1 : 0));
  return `Step ${current} of ${progress.total}`;
}

function chatLine(chat: ConversationSummary): SessionLine {
  const running = isRunning(chat);
  return {
    ...EMPTY,
    step: rowState(chat, false).sub || null,
    steps: running ? progressText(chat.latestRun?.progress) : null,
  };
}

export function waitsOnCard(chat: ConversationSummary): boolean {
  return chat.needsInput && !terminalWaitsAlone(chat);
}

export function sessionLine(
  chat: ConversationSummary,
  usage: NativeTerminalUsage | undefined,
): SessionLine {
  if (waitsOnCard(chat)) return { ...EMPTY, step: rowState(chat, false).sub || null };
  return isTerminalSession(chat) ? terminalLine(chat, usage) : chatLine(chat);
}

export function lineText(line: SessionLine, parts: readonly LinePart[] = ALL_PARTS): string {
  return parts.flatMap((part) => (line[part] ? [line[part]] : [])).join(' · ');
}

export function terminalFacts(
  chat: ConversationSummary,
  line: SessionLine,
  parts: readonly LinePart[],
): string {
  return isTerminalSession(chat) && !waitsOnCard(chat) ? lineText(line, parts) : '';
}
