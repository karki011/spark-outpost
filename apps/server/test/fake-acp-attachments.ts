import { readFile } from 'node:fs/promises';
import * as acp from '@agentclientprotocol/sdk/unstable';
import { describeBlock } from './fake-acp-support.ts';

const FILE_LINE = /is at (.+?)\. It is user-supplied data/g;

const READ_OPTIONS: acp.PermissionOption[] = [
  { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
  { optionId: 'no', name: 'Reject', kind: 'reject_once' },
];

interface Asker {
  sessionId: string;
  client: acp.AgentContext;
}

async function mayRead(asker: Asker, path: string, index: number): Promise<boolean> {
  const answer = await asker.client.request(acp.methods.client.session.requestPermission, {
    sessionId: asker.sessionId,
    toolCall: {
      toolCallId: `attached-read-${index}`,
      title: `Read ${path}`,
      kind: 'read',
      status: 'pending',
      locations: [{ path }],
    },
    options: READ_OPTIONS,
  });
  return answer.outcome.outcome === 'selected' && answer.outcome.optionId === 'yes';
}

export async function blocksTurn(
  prompt: readonly acp.ContentBlock[],
  say: (text: string) => Promise<void>,
  signal: AbortSignal,
  asker?: Asker,
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
  const asks = asker !== undefined && texts.some((text) => text.includes('#askread'));
  const files = [];
  for (const [index, path] of paths.entries()) {
    const allowed = asks ? await mayRead(asker, path, index) : true;
    files.push({ path, content: allowed ? await readFile(path, 'utf8').catch(() => null) : null });
  }
  await say(JSON.stringify({ texts, resources, files }));
  if (texts.some((text) => text.includes('#stall'))) {
    await new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  }
  return 'end_turn';
}
