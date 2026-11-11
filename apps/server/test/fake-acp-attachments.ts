import { readFile } from 'node:fs/promises';
import type * as acp from '@agentclientprotocol/sdk/unstable';
import { describeBlock } from './fake-acp-support.ts';

const FILE_LINE = /is at (.+?)\. It is user-supplied data/g;

export async function blocksTurn(
  prompt: readonly acp.ContentBlock[],
  say: (text: string) => Promise<void>,
  signal: AbortSignal,
): Promise<acp.StopReason> {
  const texts = prompt.flatMap((block) => (block.type === 'text' ? [block.text] : []));
  if (!texts.some((text) => text.includes('#files'))) {
    await say(JSON.stringify(prompt.map(describeBlock)));
    return 'end_turn';
  }
  const resources = prompt.flatMap((block) =>
    block.type === 'resource'
      ? [
          {
            uri: block.resource.uri,
            mimeType: block.resource.mimeType,
            blob: 'blob' in block.resource ? block.resource.blob : null,
          },
        ]
      : [],
  );
  const paths = texts.flatMap((text) => [...text.matchAll(FILE_LINE)].map((match) => match[1]!));
  const files = await Promise.all(
    paths.map(async (path) => ({
      path,
      content: await readFile(path, 'utf8').catch(() => null),
    })),
  );
  await say(JSON.stringify({ texts, resources, files }));
  if (texts.some((text) => text.includes('#stall'))) {
    await new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  }
  return 'end_turn';
}
