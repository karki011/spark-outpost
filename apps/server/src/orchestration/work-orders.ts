import { namedFiles } from './context.ts';

export const WORK_ORDER_LIMIT = 6_000;
export const WORK_ORDERS_LIMIT = 12_000;
export const CONTRACT_LIMIT = 3_000;
const LIST_LIMIT = 12;
const LINE_LIMIT = 400;

export interface Excerpt {
  path: string;
  lines: string | null;
  text: string;
}

export interface WorkOrder {
  steps: number[];
  goal: string;
  change: string[];
  read: string[];
  excerpts: Excerpt[];
  decisions: string[];
  acceptance: string[];
  checks: string[];
}

type Field =
  'steps' | 'goal' | 'change' | 'read' | 'decisions' | 'acceptance' | 'checks' | 'excerpt';

const FIELD_NAMES: readonly (readonly [RegExp, Field])[] = [
  [/^steps?$/, 'steps'],
  [/^(?:goal|task)$/, 'goal'],
  [/^(?:change|changes|files to change|edit)$/, 'change'],
  [/^(?:read|read only|files to read|reads)$/, 'read'],
  [/^(?:decisions?|constraints?|decisions and constraints)$/, 'decisions'],
  [/^(?:acceptance|acceptance contract|contract|done when)$/, 'acceptance'],
  [/^(?:checks?|check commands)$/, 'checks'],
  [/^excerpt$/, 'excerpt'],
];

const FIELD_LINE = /^([A-Za-z][A-Za-z ]{1,30}?)\s*:\s*(.*)$/;
const OPEN_FENCE = /^(`{3,}|~{3,})\s*work[\s_-]?order\b[^\n]*$/i;
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;
const LINE_RANGE = /(\d+)(?:\s*[-–]\s*(\d+))?\s*$/;

function fieldOf(line: string): { field: Field; value: string } | null {
  const match = FIELD_LINE.exec(line);
  if (!match) return null;
  const name = match[1]!.trim().toLowerCase();
  const found = FIELD_NAMES.find(([pattern]) => pattern.test(name));
  return found ? { field: found[1], value: match[2]!.trim() } : null;
}

function blocks(text: string): string[] {
  const lines = text.split('\n');
  const found: string[] = [];
  for (let at = 0; at < lines.length; at += 1) {
    const open = OPEN_FENCE.exec(lines[at]!.trim());
    if (!open) continue;
    const fence = open[1]!;
    const body: string[] = [];
    let end = at + 1;
    while (end < lines.length && !closes(lines[end]!, fence)) {
      body.push(lines[end]!);
      end += 1;
    }
    found.push(body.join('\n'));
    at = end;
  }
  return found;
}

function closes(line: string, fence: string): boolean {
  const trimmed = line.trim();
  return trimmed.length >= fence.length && trimmed === fence[0]!.repeat(trimmed.length);
}

function stepNumbers(value: string, count: number): number[] {
  const found: number[] = [];
  for (const match of value.matchAll(/(\d{1,2})\s*(?:[-–]|to)\s*(\d{1,2})|(\d{1,2})/g)) {
    if (match[3] !== undefined) found.push(Number(match[3]) - 1);
    else {
      for (let index = Number(match[1]) - 1; index <= Number(match[2]) - 1; index += 1) {
        found.push(index);
      }
    }
  }
  return [...new Set(found.filter((index) => index >= 0 && index < count))].sort((a, b) => a - b);
}

function fileList(values: readonly string[]): string[] {
  const text = values.join(' ').replace(/[,`]/g, ' ');
  if (/^\s*(?:none|nothing|-|n\/a)\.?\s*$/i.test(text)) return [];
  return namedFiles([text])
    .map((file) => file.replace(/^\.\//, ''))
    .slice(0, LIST_LIMIT);
}

function items(values: readonly string[]): string[] {
  return values
    .flatMap((value) => value.split('\n'))
    .map((value) => value.replace(BULLET, '').trim())
    .filter((value) => value && !/^(?:none|nothing|-|n\/a)\.?$/i.test(value))
    .map((value) => (value.length > LINE_LIMIT ? `${value.slice(0, LINE_LIMIT)}…` : value))
    .slice(0, LIST_LIMIT);
}

function commands(values: readonly string[]): string[] {
  return items(values.flatMap((value) => value.split(/[;,]\s*/)))
    .map((value) => value.replace(/^`|`$/g, '').trim())
    .filter(Boolean);
}

function excerptOf(head: string, body: readonly string[]): Excerpt | null {
  const path = namedFiles([head.replace(/[`:]/g, ' ')])[0];
  const text = trimFences(body.join('\n'));
  if (!path || !text.trim()) return null;
  const range = LINE_RANGE.exec(head.replace(path, ''));
  const lines = range ? (range[2] ? `${range[1]}-${range[2]}` : range[1]!) : null;
  return { path: path.replace(/^\.\//, ''), lines, text };
}

function trimFences(text: string): string {
  const lines = text.replace(/^\n+|\s+$/g, '').split('\n');
  if (lines[0]?.trim().startsWith('```') && lines.at(-1)?.trim() === '```') {
    return lines.slice(1, -1).join('\n');
  }
  return lines.join('\n');
}

function parseBlock(body: string, count: number, position: number): WorkOrder | null {
  const values: Record<Exclude<Field, 'excerpt'>, string[]> = {
    steps: [],
    goal: [],
    change: [],
    read: [],
    decisions: [],
    acceptance: [],
    checks: [],
  };
  const excerpts: Excerpt[] = [];
  let current: Field | null = null;
  let excerpt: { head: string; body: string[] } | null = null;
  const closeExcerpt = () => {
    const done = excerpt ? excerptOf(excerpt.head, excerpt.body) : null;
    if (done) excerpts.push(done);
    excerpt = null;
  };
  for (const line of body.split('\n')) {
    const field = fieldOf(line);
    if (field && (excerpt === null || !/^\s/.test(line))) {
      closeExcerpt();
      current = field.field;
      if (field.field === 'excerpt') excerpt = { head: field.value, body: [] };
      else if (field.value) values[field.field].push(field.value);
      continue;
    }
    if (excerpt) excerpt.body.push(line);
    else if (current && current !== 'excerpt' && line.trim()) values[current].push(line);
  }
  closeExcerpt();
  const goal = values.goal.join(' ').trim();
  const named = values.steps.length > 0;
  const steps = named ? stepNumbers(values.steps.join(' '), count) : [];
  const order: WorkOrder = {
    steps: named ? steps : position < count ? [position] : [],
    goal: goal.length > LINE_LIMIT ? `${goal.slice(0, LINE_LIMIT)}…` : goal,
    change: fileList(values.change),
    read: fileList(values.read),
    excerpts,
    decisions: items(values.decisions),
    acceptance: items(values.acceptance),
    checks: commands(values.checks),
  };
  if (order.steps.length === 0) return null;
  const empty = !order.goal && order.acceptance.length === 0 && order.change.length === 0;
  return empty ? null : order;
}

export function workOrdersFromReply(text: string, stepCount: number): WorkOrder[] {
  return blocks(text).flatMap((body, position) => parseBlock(body, stepCount, position) ?? []);
}

export function ordersForSteps(
  orders: readonly WorkOrder[],
  steps: readonly number[],
): WorkOrder[] {
  return orders.filter((order) => order.steps.some((step) => steps.includes(step)));
}

export function coversSteps(orders: readonly WorkOrder[], steps: readonly number[]): boolean {
  return steps.length > 0 && steps.every((step) => orders.some((o) => o.steps.includes(step)));
}

function stepLabel(steps: readonly number[]): string {
  const numbers = steps.map((index) => index + 1);
  return numbers.length === 1 ? `Step ${numbers[0]}` : `Steps ${numbers.join(', ')}`;
}

function listLine(title: string, values: readonly string[]): string[] {
  return values.length > 0 ? [`${title}: ${values.join(', ')}`] : [];
}

function bullets(title: string, values: readonly string[]): string[] {
  return values.length > 0 ? [`${title}:`, ...values.map((value) => `- ${value}`)] : [];
}

function excerptText(excerpt: Excerpt): string {
  const where = excerpt.lines ? `${excerpt.path}:${excerpt.lines}` : excerpt.path;
  return `${where}\n\`\`\`\n${excerpt.text}\n\`\`\``;
}

function fitExcerpts(excerpts: readonly Excerpt[], budget: number): string[] {
  const shown: string[] = [];
  let left = budget;
  for (const excerpt of excerpts) {
    const text = excerptText(excerpt);
    if (text.length <= left) {
      shown.push(text);
      left -= text.length + 1;
      continue;
    }
    const room = left - excerpt.path.length - (excerpt.lines?.length ?? 0) - 60;
    if (room > 200) {
      shown.push(excerptText({ ...excerpt, text: `${excerpt.text.slice(0, room)}\n[cut]` }));
    }
    const skipped = excerpts.length - shown.length;
    if (skipped > 0) shown.push(`[${skipped} more excerpt${skipped === 1 ? '' : 's'} left out]`);
    break;
  }
  return shown;
}

export function workOrderText(order: WorkOrder, limit = WORK_ORDER_LIMIT): string {
  const head = [
    `${stepLabel(order.steps)}${order.goal ? `: ${order.goal}` : ''}`,
    ...listLine('Change', order.change),
    ...listLine('Read only', order.read),
    ...bullets('Decisions and constraints', order.decisions),
    ...bullets('Acceptance contract', order.acceptance),
    ...listLine('Checks the Architect expects to pass', order.checks),
  ].join('\n');
  const fixed = head.length > limit ? `${head.slice(0, limit)}\n[cut]` : head;
  const excerpts = fitExcerpts(order.excerpts, limit - fixed.length - 60);
  if (excerpts.length === 0) return fixed;
  return `${fixed}\nExcerpts the Architect already read:\n${excerpts.join('\n')}`;
}

export function workOrdersText(orders: readonly WorkOrder[]): string {
  const share = Math.min(
    WORK_ORDER_LIMIT,
    Math.floor(WORK_ORDERS_LIMIT / Math.max(1, orders.length)),
  );
  return orders.map((order) => workOrderText(order, share)).join('\n\n');
}

export function orderedFiles(orders: readonly WorkOrder[]): string[] {
  const files = orders.flatMap((order) => [
    ...order.change,
    ...order.read,
    ...order.excerpts.map((excerpt) => excerpt.path),
  ]);
  return [...new Set(files)];
}

export function contractText(orders: readonly WorkOrder[]): string | null {
  const lines = orders.flatMap((order) => {
    const criteria = order.acceptance.length > 0 ? order.acceptance : [];
    if (!order.goal && criteria.length === 0) return [];
    return [
      `${stepLabel(order.steps)}${order.goal ? `: ${order.goal}` : ''}`,
      ...criteria.map((criterion) => `- ${criterion}`),
    ];
  });
  if (lines.length === 0) return null;
  const text = lines.join('\n');
  return text.length > CONTRACT_LIMIT ? `${text.slice(0, CONTRACT_LIMIT)}\n[cut]` : text;
}

const EXTRA_READS = /^[\s*_#>-]*extra files read[\s*_]*:[\s*_]*(.*)$/im;

export function extraReadsFromReply(text: string): string | null {
  const line = EXTRA_READS.exec(text)?.[1]?.trim();
  if (line === undefined) return null;
  return line.length > LINE_LIMIT ? `${line.slice(0, LINE_LIMIT)}…` : line;
}
