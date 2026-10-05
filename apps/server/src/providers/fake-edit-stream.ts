import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { ProviderOutput, ProviderTurn } from './provider.ts';

const TRIGGER = /#livediff(?: (\d{1,4}))?(?: (\d{1,3})ms)?/;
const DEFAULT_EDITS = 300;
const DEFAULT_GAP_MS = 25;
const SPREAD_FILES = 60;
const GROWTH_LINES = 25;
const TOOL_EVERY = 10;
export const LIVE_DIFF_GROWING_FILE = 'src/live/growing.ts';

export interface EditStreamPlan {
  edits: number;
  gapMs: number;
}

export function editStreamPlan(prompt: string): EditStreamPlan | null {
  const match = TRIGGER.exec(prompt);
  if (!match) return null;
  return {
    edits: match[1] ? Number(match[1]) : DEFAULT_EDITS,
    gapMs: match[2] ? Number(match[2]) : DEFAULT_GAP_MS,
  };
}

function spreadFile(edit: number): string {
  const slot = Math.floor(edit / 2) % SPREAD_FILES;
  return `src/live/area${slot % 12}/module${slot}.ts`;
}

function grownLines(edit: number): string {
  return Array.from({ length: GROWTH_LINES }, (_, offset) => {
    const row = edit * GROWTH_LINES + offset;
    return `export const row${row} = compute(${row}, 'row ${row} written live');\n`;
  }).join('');
}

async function applyEdit(root: string, edit: number): Promise<string> {
  const relative = edit % 2 === 0 ? LIVE_DIFF_GROWING_FILE : spreadFile(edit);
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  if (relative === LIVE_DIFF_GROWING_FILE) await appendFile(target, grownLines(edit));
  else
    await writeFile(
      target,
      `export const revision = ${edit};\nexport const name = '${relative}';\n`,
    );
  return relative;
}

export async function* fakeEditStream(
  turn: ProviderTurn,
  plan: EditStreamPlan,
): AsyncGenerator<ProviderOutput> {
  const root = turn.projectRoots?.[0];
  if (!root || turn.mode !== 'do') {
    yield { kind: 'text_delta', delta: 'livediff=unavailable' };
    return;
  }
  for (let edit = 0; edit < plan.edits; edit++) {
    const relative = edit % 2 === 0 ? LIVE_DIFF_GROWING_FILE : spreadFile(edit);
    const name = `Edit ${relative}`;
    const tool = edit % TOOL_EVERY === 0;
    yield {
      kind: 'file_focus',
      path: path.join(root, relative),
      line: edit % 2 === 0 ? (edit / 2) * GROWTH_LINES + 1 : null,
      limit: null,
      action: 'edit',
    };
    yield { kind: 'step_started', name, tool, toolKind: 'edit' };
    await applyEdit(root, edit);
    await delay(plan.gapMs, undefined, { signal: turn.signal });
    yield { kind: 'step_finished', name, tool, toolKind: 'edit' };
    if (edit % 10 === 9) yield { kind: 'text_delta', delta: `Edited ${edit + 1} times. ` };
  }
  yield { kind: 'text_delta', delta: `livediff=done ${plan.edits}` };
}
