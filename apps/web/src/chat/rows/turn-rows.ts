import { friendlyStep, isSparkNote, toolLabel, type BrowserShot } from '@spark-outpost/contracts';
import { anchorIndex, outsideFence } from '../../browser/shot-order.ts';
import type { AgentTerminalView } from '../commands/agent-terminal-model.ts';
import type { CommandView } from '../commands/command-model.ts';
import type { StepStatus, StepTimes, StepView } from '../run-projection.ts';
import { stepActivity } from '../status/step-activity.ts';

const THINKING = 'Thinking';
const WEB_STEP = /^(?:Fetched |Searched the web$)/;
const WEB_SEARCHED = 'Searched the web';

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

type ToolBase = Omit<ToolItem, 'tone' | 'verb' | 'target'>;

const FILE_KIND_VERBS: Record<string, [done: string, open: string]> = {
  read: DONE_VERBS.read,
  edit: DONE_VERBS.edit,
  delete: ['Deleted', 'Deleting'],
  move: ['Moved', 'Moving'],
};

function fromToolKind(step: StepView, base: ToolBase, open: boolean): ToolItem | null {
  const kind = step.toolKind;
  if (!kind) return null;
  const verbs = FILE_KIND_VERBS[kind];
  if (verbs && step.target) {
    const tone = kind === 'read' ? 'read' : 'edit';
    return { ...base, tone, verb: verbs[open ? 1 : 0], target: step.target };
  }
  return null;
}

function fromName(step: StepView, base: ToolBase, open: boolean, ranCommands: boolean) {
  const activity = stepActivity(step.name);
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
