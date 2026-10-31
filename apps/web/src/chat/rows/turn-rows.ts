import {
  friendlyStep,
  isMcpToolName,
  isSparkNote,
  toolLabel,
  type BrowserShot,
} from '@spark-outpost/contracts';
import { anchorIndex, outsideFence, type TextAnchor } from '../../browser/shot-order.ts';
import type { AgentTerminalView } from '../commands/agent-terminal-model.ts';
import type { CommandView } from '../commands/command-model.ts';
import type { StepStatus, StepTimes, StepView } from '../run-projection.ts';
import { cardAt, type CardMark } from './card-place.ts';
import { REFUSED_VERB, stepActivity } from '../status/step-activity.ts';

const THINKING = 'Thinking';
const SENTENCE_END = /[.!?:]\s*$/;
const WEB_STEP = /^(?:Fetched |Searched the web$)/;
const WEB_SEARCHED = 'Searched the web';

export type ToolTone = 'read' | 'search' | 'edit' | 'run' | 'web' | 'tool' | 'other';

export interface ToolItem {
  kind: 'tool';
  key: string;
  tone: ToolTone;
  status: StepStatus;
  verb: string;
  target: string | null;
  path: string | null;
  label: string;
  detail?: string;
  startedAt: number | undefined;
  finishedAt: number | undefined;
}

export interface ThoughtItem {
  kind: 'thought';
  key: string;
  step: StepView;
}

export interface CommandItem {
  kind: 'command';
  key: string;
  command: CommandView;
}

export interface TodoItem {
  kind: 'todo';
  key: string;
}

export type RowItem = ToolItem | ThoughtItem | CommandItem | TodoItem;
export type GroupedItem = ToolItem | CommandItem | ThoughtItem;
export type LiveItem = ToolItem | CommandItem | ThoughtItem;

export interface RowGroup {
  kind: 'group';
  key: string;
  items: GroupedItem[];
  live: LiveItem | null;
}

export type Row = RowItem | RowGroup;

export type TurnRowPart =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'shots'; key: string; shots: BrowserShot[] }
  | { kind: 'terminal'; key: string; terminals: AgentTerminalView[] }
  | { kind: 'rows'; key: string; rows: Row[] }
  | { kind: 'steers'; key: string; ids: string[]; wroteAfter: boolean }
  | { kind: 'cards'; key: string; ids: string[] };

export interface SteerMark {
  id: string;
  anchor: TextAnchor | null;
  time: number;
}

export interface TurnRowInput {
  text: string;
  steps: readonly StepView[];
  commands: readonly CommandView[];
  shots?: readonly BrowserShot[];
  terminals?: readonly AgentTerminalView[];
  steers?: readonly SteerMark[];
  cards?: readonly CardMark[];
  todo?: boolean;
}

type Placed =
  | { kind: 'item'; at: number; time: number | null; item: RowItem }
  | { kind: 'shot'; at: number; time: number | null; shot: BrowserShot }
  | { kind: 'terminal'; at: number; time: number | null; terminal: AgentTerminalView }
  | { kind: 'steer'; at: number; time: number | null; id: string; wroteAfter: boolean }
  | { kind: 'card'; at: number; time: number | null; id: string };

const DONE_VERBS: Record<'read' | 'search' | 'edit', [done: string, open: string]> = {
  read: ['Read', 'Reading'],
  search: ['Searched', 'Searching'],
  edit: ['Edited', 'Editing'],
};

function plainName(name: string): string {
  return friendlyStep(name).replaceAll('`', '');
}

type ToolBase = Omit<ToolItem, 'tone' | 'verb' | 'target' | 'path'>;

const FILE_KIND_VERBS: Record<string, [done: string, open: string]> = {
  read: DONE_VERBS.read,
  edit: DONE_VERBS.edit,
  delete: ['Deleted', 'Deleting'],
  move: ['Moved', 'Moving'],
};

export function baseName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

function fromToolKind(step: StepView, base: ToolBase, open: boolean): ToolItem | null {
  const kind = step.toolKind;
  if (!kind) return null;
  const verbs = FILE_KIND_VERBS[kind];
  if (verbs && step.target) {
    const tone = kind === 'read' ? 'read' : 'edit';
    const target = baseName(step.target);
    return { ...base, tone, verb: verbs[open ? 1 : 0], target, path: step.target };
  }
  return null;
}

function fromName(step: StepView, base: ToolBase, open: boolean, ranCommands: boolean) {
  const item = namedItem(step, base, open, ranCommands);
  return item && { ...item, path: null };
}

function namedItem(step: StepView, base: ToolBase, open: boolean, ranCommands: boolean) {
  const activity = stepActivity(step.name);
  if (activity.verb === REFUSED_VERB && activity.detail) {
    const { target, detail } = activity;
    return { ...base, tone: 'other' as const, verb: REFUSED_VERB, target, detail };
  }
  if (activity.kind === 'run' || step.toolKind === 'execute') {
    if (ranCommands) return null;
    const target = activity.kind === 'run' ? activity.target : base.label;
    return { ...base, tone: 'run' as const, verb: open ? 'Running' : 'Ran', target };
  }
  if (WEB_STEP.test(base.label)) {
    const [verb = '', ...rest] = base.label.split(' ');
    return { ...base, tone: 'web' as const, verb, target: rest.join(' ') || null };
  }
  if (activity.kind === 'edit' && activity.target) {
    const verb = DONE_VERBS.edit[open ? 1 : 0];
    return { ...base, tone: 'edit' as const, verb, target: activity.target };
  }
  if (activity.kind === 'read' && activity.target) {
    const verb = DONE_VERBS.read[open ? 1 : 0];
    return { ...base, tone: 'read' as const, verb, target: activity.target };
  }
  if (activity.kind === 'search' || step.toolKind === 'search') {
    const verb = DONE_VERBS.search[open ? 1 : 0];
    const target = base.label.split(/\s+/).slice(1).join(' ') || null;
    return { ...base, tone: 'search' as const, verb, target };
  }
  return { ...base, tone: 'other' as const, verb: base.label, target: null };
}

const NAME_TONES: Readonly<Record<string, ToolTone>> = {
  Read: 'read',
  view_image: 'read',
  Grep: 'search',
  Glob: 'search',
  Edit: 'edit',
  MultiEdit: 'edit',
  Write: 'edit',
  NotebookEdit: 'edit',
  Bash: 'run',
  PowerShell: 'run',
  WebFetch: 'web',
  WebSearch: 'web',
};

function namedTarget(item: ToolItem, toolName: string, verb: string): string | null {
  if (item.tone === 'web') return item.label === WEB_SEARCHED ? null : item.target;
  if (item.tone !== 'other') return item.target;
  const restated = item.label === verb || item.label === plainName(toolName);
  return restated ? null : item.label;
}

function named(item: ToolItem, toolName: string | undefined): ToolItem {
  const verb = toolLabel(toolName);
  if (!toolName || !verb) return item;
  const target = namedTarget(item, toolName, verb);
  return { ...item, tone: NAME_TONES[toolName] ?? item.tone, verb, target };
}

function toolItem(step: StepView, key: string, ranCommands: boolean): ToolItem | null {
  const open = step.status === 'open';
  const base: ToolBase = {
    kind: 'tool',
    key,
    status: step.status,
    label: plainName(step.name),
    startedAt: step.startedAt,
    finishedAt: step.finishedAt,
  };
  if (step.toolName && isMcpToolName(step.toolName) && step.toolKind !== 'execute') {
    return { ...base, tone: 'tool', verb: base.label, target: null, path: null };
  }
  const item = fromToolKind(step, base, open) ?? fromName(step, base, open, ranCommands);
  return item && named(item, step.toolName);
}

function isThought(step: StepView): boolean {
  return step.name === THINKING || Boolean(step.reasoningId);
}

function stepItems(steps: readonly StepView[], ranCommands: boolean): RowItem[] {
  return steps.flatMap((step, index): RowItem[] => {
    if (step.subagent || isSparkNote(step.name)) return [];
    const key = `step-${index}`;
    if (isThought(step)) return [{ kind: 'thought', key, step }];
    const item = toolItem(step, key, ranCommands);
    return item ? [item] : [];
  });
}

function placeAt(text: string, anchor: Parameters<typeof anchorIndex>[1]): number {
  return outsideFence(text, anchorIndex(text, anchor) ?? text.length);
}

function stepAt(text: string, step: StepView): number {
  if (step.textOffset === undefined) return 0;
  return placeAt(text, {
    textOffset: step.textOffset,
    textBefore: step.textBefore ?? null,
    textHeld: step.textHeld ?? null,
  });
}

function paragraphEnd(text: string, at: number): number {
  if (at === 0 || at >= text.length || text[at - 1] === '\n') return at;
  const end = text.indexOf('\n\n', at);
  return outsideFence(text, end === -1 ? text.length : end);
}

function sentenceSafe(text: string, at: number): number {
  return SENTENCE_END.test(text.slice(0, at)) ? at : paragraphEnd(text, at);
}

function steerPlace(text: string, steer: SteerMark): { at: number; wroteAfter: boolean } {
  if (!steer.anchor) return { at: text.length, wroteAfter: false };
  const anchor = placeAt(text, steer.anchor);
  const at = paragraphEnd(text, anchor);
  return { at, wroteAfter: text.slice(anchor, at).trim() !== '' };
}

function itemUntil(item: RowItem): number | null {
  if (item.kind === 'command') {
    if (item.command.status === 'running') return Number.POSITIVE_INFINITY;
    return item.command.finishedAt ? Date.parse(item.command.finishedAt) : null;
  }
  if (item.kind === 'thought') {
    return item.step.status === 'open' ? Number.POSITIVE_INFINITY : (item.step.finishedAt ?? null);
  }
  if (item.kind === 'tool') {
    return item.status === 'open' ? Number.POSITIVE_INFINITY : (item.finishedAt ?? null);
  }
  return null;
}

function placedUntil(placed: Placed): number | null {
  return placed.kind === 'item' ? itemUntil(placed.item) : null;
}

function placedItems(input: TurnRowInput): Placed[] {
  const { text, steps, commands, shots = [], terminals = [], steers = [], cards = [] } = input;
  const items = stepItems(steps, commands.length > 0);
  const stepsByKey = new Map(steps.map((step, index) => [`step-${index}`, step]));
  const placed: Placed[] = [
    ...items.map((item): Placed => {
      const step = stepsByKey.get(item.key)!;
      return { kind: 'item', at: stepAt(text, step), time: step.startedAt ?? null, item };
    }),
    ...commands.map((command): Placed => ({
      kind: 'item',
      at: placeAt(text, command),
      time: Date.parse(command.startedAt),
      item: { kind: 'command', key: `command-${command.id}`, command },
    })),
    ...shots.map((shot): Placed => ({
      kind: 'shot',
      at: placeAt(text, shot),
      time: Date.parse(shot.createdAt),
      shot,
    })),
    ...terminals.map((terminal): Placed => ({
      kind: 'terminal',
      at: placeAt(text, terminal),
      time: Date.parse(terminal.startedAt),
      terminal,
    })),
    ...steers.map((steer): Placed => ({
      kind: 'steer',
      ...steerPlace(text, steer),
      time: steer.time,
      id: steer.id,
    })),
  ];
  const offsetAt = (textOffset: number) =>
    sentenceSafe(text, placeAt(text, { textOffset, textBefore: null, textHeld: null }));
  const timedItems = placed.map((item) => ({ ...item, until: placedUntil(item) }));
  placed.push(
    ...cards.map((card): Placed => ({
      kind: 'card',
      at: cardAt(text, card, timedItems, offsetAt),
      time: card.time,
      id: card.id,
    })),
  );
  return placed.sort(
    (left, right) =>
      left.at - right.at ||
      (left.time !== null && right.time !== null ? left.time - right.time : 0),
  );
}

const GROUPED_TONES = new Set<ToolTone>(['read', 'search', 'edit', 'run', 'tool']);

function groupable(item: RowItem): item is GroupedItem {
  if (item.kind === 'command') return item.command.status !== 'running';
  if (item.kind === 'thought') return item.step.status !== 'open';
  return item.kind === 'tool' && item.status !== 'open' && GROUPED_TONES.has(item.tone);
}

function isLive(item: RowItem): item is LiveItem {
  if (item.kind === 'command') return item.command.status === 'running';
  if (item.kind === 'thought') return item.step.status === 'open';
  if (item.kind === 'tool') return item.status === 'open';
  return false;
}

function grouped(items: GroupedItem[]): Row[] {
  const steps = items.filter((item) => item.kind !== 'thought');
  if (steps.length < 2) return items;
  return [{ kind: 'group', key: `group-${items[0]!.key}`, items, live: null }];
}

function withLiveTail(rows: Row[]): Row[] {
  const last = rows.at(-1);
  const before = rows.at(-2);
  if (!last || before?.kind !== 'group' || last.kind === 'group' || !isLive(last)) return rows;
  return [...rows.slice(0, -2), { ...before, live: last }];
}

export function groupRows(items: readonly RowItem[]): Row[] {
  const rows: Row[] = [];
  let run: GroupedItem[] = [];
  for (const item of items) {
    if (groupable(item)) {
      run.push(item);
      continue;
    }
    rows.push(...grouped(run), item);
    run = [];
  }
  rows.push(...grouped(run));
  return withLiveTail(rows);
}

function withTodo(items: readonly RowItem[]): RowItem[] {
  const after = items.findIndex((item) => item.kind !== 'thought');
  const at = after === -1 ? items.length : after;
  return [...items.slice(0, at), { kind: 'todo', key: 'todo' }, ...items.slice(at)];
}

export function turnRowParts(input: TurnRowInput): TurnRowPart[] {
  const { text } = input;
  const parts: TurnRowPart[] = [];
  let from = 0;
  let texts = 0;
  let pending: RowItem[] = [];
  let todoPlaced = !input.todo;
  const flushRows = () => {
    if (!todoPlaced) {
      pending = withTodo(pending);
      todoPlaced = true;
    }
    if (pending.length === 0) return;
    parts.push({ kind: 'rows', key: `rows-${pending[0]!.key}`, rows: groupRows(pending) });
    pending = [];
  };
  const addText = (to: number) => {
    const slice = text.slice(from, to);
    from = to;
    if (slice.trim() === '') return;
    flushRows();
    parts.push({ kind: 'text', key: `text-${texts}`, text: slice });
    texts += 1;
  };
  for (const placed of placedItems(input)) {
    addText(placed.at);
    if (placed.kind === 'item') {
      pending.push(placed.item);
      continue;
    }
    flushRows();
    if (placed.kind === 'card') {
      const last = parts.at(-1);
      if (last?.kind === 'cards') last.ids.push(placed.id);
      else parts.push({ kind: 'cards', key: `cards-${placed.id}`, ids: [placed.id] });
      continue;
    }
    if (placed.kind === 'steer') {
      const last = parts.at(-1);
      if (last?.kind === 'steers' && last.wroteAfter === placed.wroteAfter) {
        last.ids.push(placed.id);
      } else {
        const { id, wroteAfter } = placed;
        parts.push({ kind: 'steers', key: `steers-${id}`, ids: [id], wroteAfter });
      }
      continue;
    }
    if (placed.kind === 'terminal') {
      const { terminal } = placed;
      const last = parts.at(-1);
      if (last?.kind === 'terminal') last.terminals.push(terminal);
      else parts.push({ kind: 'terminal', key: `terminal-${terminal.id}`, terminals: [terminal] });
      continue;
    }
    const last = parts.at(-1);
    if (last?.kind === 'shots') last.shots.push(placed.shot);
    else parts.push({ kind: 'shots', key: `shots-${placed.shot.id}`, shots: [placed.shot] });
  }
  addText(text.length);
  flushRows();
  return parts;
}

export function spanSeconds(items: readonly StepTimes[]): number | null {
  const starts = items.map((item) => item.startedAt);
  const ends = items.map((item) => item.finishedAt);
  if (starts.some((at) => at === undefined) || ends.some((at) => at === undefined)) return null;
  const seconds = Math.round(
    (Math.max(...(ends as number[])) - Math.min(...(starts as number[]))) / 1000,
  );
  return seconds >= 1 ? seconds : null;
}
