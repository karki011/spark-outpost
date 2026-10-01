import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type * as acp from '@agentclientprotocol/sdk';

interface LawTurn {
  text: string;
  cwd: string;
  signal: AbortSignal;
  update(value: acp.SessionUpdate): Promise<void>;
}

export const TOTALS_FILE = 'src/totals.ts';
export const TOTALS_SOURCE = `export function sumTotals(rows: number[]): number {
  return rows.reduce((sum, row) => sum + row, 0);
}

export function helperTotals(rows: number[]): number {
  return rows.length;
}
`;

export const NOTES_TEST_FILE = 'src/notes.test.ts';
export const NOTES_TEST_SOURCE = `import { expect, it } from 'vitest';

it('reads notes', () => {
  expect(read('a')).toBe('a');
  expect(read('b')).toBe('b');
});
`;

async function edit(turn: LawTurn, file: string, change: (text: string) => string) {
  const path = join(turn.cwd, file);
  await writeFile(path, change(await readFile(path, 'utf8')));
}

async function reads(turn: LawTurn, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    if (turn.signal.aborted) throw new Error('aborted');
    await turn.update({
      sessionUpdate: 'tool_call',
      toolCallId: `law-read-${index}`,
      title: `Read \`src/part-${index}.ts\``,
      kind: 'read',
      locations: [{ path: `src/part-${index}.ts` }],
      status: 'completed',
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export async function lawEdits(turn: LawTurn): Promise<string> {
  const replies: string[] = [];
  if (turn.text.includes('#removehelper')) {
    const file = existsSync(join(turn.cwd, TOTALS_FILE)) ? TOTALS_FILE : 'totals.ts';
    await edit(turn, file, (text) => text.slice(0, text.indexOf('\nexport function helper')));
    if (turn.text.includes('#explainremoval')) {
      replies.push('Removed helperTotals because nothing calls it any more.');
    }
  }
  if (turn.text.includes('#weakentest')) {
    await edit(turn, NOTES_TEST_FILE, (text) =>
      text.replace("it('reads", "it.skip('reads").replace("  expect(read('b')).toBe('b');\n", ''),
    );
  }
  if (turn.text.includes('#strictoff')) {
    await writeFile(
      join(turn.cwd, 'tsconfig.json'),
      '{ "compilerOptions": { "strict": false } }\n',
    );
  }
  if (turn.text.includes('#claimpass')) replies.push('All tests pass.');
  const many = /#manyreads (\d+)/.exec(turn.text)?.[1];
  if (many) await reads(turn, Number(many));
  return replies.map((reply) => ` ${reply}`).join('');
}

const REMOVALS_HEADING = '## Removals Spark found that nothing explains yet';

export function echoedRemovals(text: string): string[] {
  if (!text.includes('#criticremoval')) return [];
  const start = text.indexOf(REMOVALS_HEADING);
  if (start === -1) return [];
  const body = text.slice(start + REMOVALS_HEADING.length).split('\n## ')[0] ?? '';
  return body
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => `[removed] ${line.slice(2)}`);
}
