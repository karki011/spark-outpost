import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ProviderOutput, ProviderTurn } from './provider.ts';

export const FAKE_FILES_TRIGGER = '#files';

const ONE_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export const FAKE_FILES = [
  { name: 'cpi.csv', data: Buffer.from('month,index\n2026-09,318.1\n2026-10,318.4\n') },
  { name: 'chart.png', data: Buffer.from(ONE_PIXEL_PNG, 'base64') },
] as const;

export function wantsFiles(prompt: string): boolean {
  return prompt.includes(FAKE_FILES_TRIGGER);
}

export async function* fakeFilesTurn(turn: ProviderTurn): AsyncGenerator<ProviderOutput> {
  const root = turn.projectRoots?.[0];
  if (!root || turn.mode !== 'do') {
    yield { kind: 'text_delta', delta: 'files=unavailable' };
    return;
  }
  const step = `Wrote ${FAKE_FILES.map((file) => file.name).join(', ')}`;
  yield { kind: 'step_started', name: step, tool: true, toolKind: 'edit' };
  await mkdir(root, { recursive: true });
  for (const file of FAKE_FILES) await writeFile(path.join(root, file.name), file.data);
  yield { kind: 'step_finished', name: step, tool: true, toolKind: 'edit' };
  yield { kind: 'text_delta', delta: `files=done ${turn.chatFolder ? 'own-folder' : 'project'}` };
}
