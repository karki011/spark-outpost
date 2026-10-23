import { friendlyStep, isSparkNote, type BrowserShot } from '@spark-outpost/contracts';
import { anchorIndex, outsideFence } from '../../browser/shot-order.ts';
import type { AgentTerminalView } from '../commands/agent-terminal-model.ts';
import type { CommandView } from '../commands/command-model.ts';
import type { StepStatus, StepTimes, StepView } from '../run-projection.ts';
import { stepActivity } from '../status/step-activity.ts';

const THINKING = 'Thinking';
const WEB_STEP = /^(?:Fetched |Searched the web$)/;

export type RowFamily = 'explore' | 'edit' | 'run';
export type ToolTone = 'read' | 'search' | 'edit' | 'run' | 'web' | 'other';

export interface ToolItem {
  kind: 'tool';
  key: string;
  tone: ToolTone;
  status: StepStatus;
  verb: string;
  target: string | null;
  label: string;
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
export type GroupedItem = ToolItem | CommandItem;

export interface RowGroup {
  kind: 'group';
  key: string;
  family: RowFamily;
  items: GroupedItem[];
}

export type Row = RowItem | RowGroup;

export type TurnRowPart =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'shots'; key: string; shots: BrowserShot[] }
  | { kind: 'terminal'; key: string; terminal: AgentTerminalView }
  | { kind: 'rows'; key: string; rows: Row[] };

export interface TurnRowInput {
  text: string;
  steps: readonly StepView[];
  commands: readonly CommandView[];
  shots?: readonly BrowserShot[];
  terminals?: readonly AgentTerminalView[];
  todo?: boolean;
}

type Placed =
  | { kind: 'item'; at: number; time: number | null; item: RowItem }
  | { kind: 'shot'; at: number; time: number | null; shot: BrowserShot }
  | { kind: 'terminal'; at: number; time: number | null; terminal: AgentTerminalView };

const DONE_VERBS: Record<'read' | 'search' | 'edit', [done: string, open: string]> = {
  read: ['Read', 'Reading'],
  search: ['Searched', 'Searching'],
  edit: ['Edited', 'Editing'],
};

function plainName(name: string): string {
  return friendlyStep(name).replaceAll('`', '');
}

function toolItem(step: StepView, key: string, ranCommands: boolean): ToolItem | null {
  const activity = stepActivity(step.name);
  const open = step.status === 'open';
  const base = {
    kind: 'tool' as const,
    key,
    status: step.status,
    label: plainName(step.name),
    startedAt: step.startedAt,
    finishedAt: step.finishedAt,
  };
  if (activity.kind === 'run') {
    if (ranCommands) return null;
    return { ...base, tone: 'run', verb: open ? 'Running' : 'Ran', target: activity.target };
  }
  if (WEB_STEP.test(base.label)) {
    const [verb = '', ...rest] = base.label.split(' ');
    return { ...base, tone: 'web', verb, target: rest.join(' ') || null };
  }
  if (activity.kind === 'edit' && activity.target) {
    const verb = DONE_VERBS.edit[open ? 1 : 0];
    return { ...base, tone: 'edit', verb, target: activity.target };
  }
  if (activity.kind === 'read' && activity.target) {
    const verb = DONE_VERBS.read[open ? 1 : 0];
    return { ...base, tone: 'read', verb, target: activity.target };
  }
  if (activity.kind === 'search') {
    const verb = DONE_VERBS.search[open ? 1 : 0];
    const target = base.label.split(/\s+/).slice(1).join(' ') || null;
    return { ...base, tone: 'search', verb, target };
  }
  return { ...base, tone: 'other', verb: base.label, target: null };
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

function placedItems(input: TurnRowInput): Placed[] {
  const { text, steps, commands, shots = [], terminals = [] } = input;
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
  ];
  return placed.sort(
    (left, right) =>
      left.at - right.at ||
      (left.time !== null && right.time !== null ? left.time - right.time : 0),
  );
}

function familyOf(item: RowItem): RowFamily | null {
  if (item.kind === 'command') return item.command.status === 'running' ? null : 'run';
  if (item.kind !== 'tool' || item.status === 'open') return null;
  if (item.tone === 'read' || item.tone === 'search') return 'explore';
  if (item.tone === 'edit') return 'edit';
  if (item.tone === 'run') return 'run';
  return null;
}

export function groupRows(items: readonly RowItem[]): Row[] {
  const rows: Row[] = [];
  let family: RowFamily | null = null;
  let run: GroupedItem[] = [];
  const flush = () => {
    if (run.length > 1 && family) {
      rows.push({ kind: 'group', key: `group-${run[0]!.key}`, family, items: run });
    } else {
      rows.push(...run);
    }
    run = [];
    family = null;
  };
  for (const item of items) {
    const next = familyOf(item);
    if (next === null || (item.kind !== 'tool' && item.kind !== 'command')) {
      flush();
      rows.push(item);
      continue;
    }
    if (next !== family) flush();
    family = next;
    run.push(item);
  }
  flush();
  return rows;
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
    if (placed.kind === 'terminal') {
      const { terminal } = placed;
      parts.push({ kind: 'terminal', key: `terminal-${terminal.id}`, terminal });
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

export function groupSummary(group: RowGroup): string {
  if (group.family === 'explore') {
    const files = group.items.filter((item) => item.kind === 'tool' && item.tone === 'read');
    const searches = group.items.length - files.length;
    return [counted(files.length, 'file'), counted(searches, 'search', 'searches')]
      .filter(Boolean)
      .join(', ');
  }
  if (group.family === 'edit') return counted(group.items.length, 'file');
  return counted(group.items.length, 'command');
}

export function groupVerb(family: RowFamily): string {
  if (family === 'explore') return 'Explored';
  return family === 'edit' ? 'Edited' : 'Ran';
}

function counted(count: number, one: string, many = `${one}s`): string {
  if (count === 0) return '';
  return `${count} ${count === 1 ? one : many}`;
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
