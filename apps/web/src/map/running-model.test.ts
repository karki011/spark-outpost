import { describe, expect, it } from 'vitest';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { EDGES, PROJECT, SERVER, WEB, sampleDetail, sampleMap } from './map-samples.ts';
import {
  activeChatsIn,
  NO_MARKS,
  runningMarks,
  wantedPaths,
  type RunningChat,
} from './running-model.ts';
import { areaKey, buildScene } from './scene.ts';

const input = [{ projectId: PROJECT, name: 'app', map: sampleMap(PROJECT, [WEB, SERVER]) }];
const webOnly = new Map([[areaKey(PROJECT, WEB.id), sampleDetail(WEB, EDGES)]]);

const ADA: RunningChat = {
  id: 'ada',
  title: 'Fix tickets',
  status: 'running',
  projectId: PROJECT,
  paths: ['apps/web/src/tickets/Tickets.tsx', 'apps/web/src/tickets/ticket-model.ts'],
};
const BEN: RunningChat = {
  id: 'ben',
  title: 'Server work',
  status: 'queued',
  projectId: PROJECT,
  paths: ['apps/server/src/tickets/routes.ts'],
};

function chat(id: string, status: string | null, extra: Partial<ConversationSummary> = {}) {
  return {
    id,
    projectIds: [PROJECT],
    archivedAt: null,
    latestRun: status === null ? null : { id: `run-${id}`, status },
    ...extra,
  } as unknown as ConversationSummary;
}

describe('activeChatsIn', () => {
  it('keeps running, queued and waiting chats of the selected projects only', () => {
    const chats = [
      chat('running', 'running'),
      chat('queued', 'queued'),
      chat('waiting', 'awaiting_approval'),
      chat('done', 'succeeded'),
      chat('failed', 'failed'),
      chat('idle', null),
      chat('archived', 'running', { archivedAt: '2026-01-01' }),
      chat('elsewhere', 'running', { projectIds: ['other'] }),
    ];
    expect(activeChatsIn(chats, [PROJECT]).map((c) => c.id)).toEqual([
      'running',
      'queued',
      'waiting',
    ]);
  });
});

describe('runningMarks', () => {
  it('marks drawn files for the chats that changed them and counts files per chat', () => {
    const scene = buildScene(input, webOnly);
    const marks = runningMarks(scene, [ADA, BEN], null);
    expect([...marks.changed].map((i) => scene.files[i]!.path).sort()).toEqual([
      'apps/web/src/tickets/Tickets.tsx',
      'apps/web/src/tickets/ticket-model.ts',
    ]);
    expect(marks.perChat).toEqual([
      { id: 'ada', files: 2 },
      { id: 'ben', files: 1 },
    ]);
  });

  it('falls back to the area for a file that is not drawn', () => {
    const scene = buildScene(input, webOnly);
    const marks = runningMarks(scene, [BEN], null);
    expect(marks.changed.size).toBe(0);
    expect(marks.areas.get(areaKey(PROJECT, SERVER.id))).toBe(1);
  });

  it('counts every changed path in its area, drawn or not', () => {
    const scene = buildScene(input, webOnly);
    const marks = runningMarks(scene, [ADA, BEN], null);
    expect(marks.areas.get(areaKey(PROJECT, WEB.id))).toBe(2);
    expect(marks.areas.get(areaKey(PROJECT, SERVER.id))).toBe(1);
  });

  it('limits the marks to the focused chat but still lists every chat', () => {
    const scene = buildScene(input, webOnly);
    const marks = runningMarks(scene, [ADA, BEN], 'ben');
    expect(marks.changed.size).toBe(0);
    expect([...marks.areas.keys()]).toEqual([areaKey(PROJECT, SERVER.id)]);
    expect(marks.perChat.map((entry) => entry.id)).toEqual(['ada', 'ben']);
  });

  it('marks nothing when no chat is active or a path is on no area', () => {
    const scene = buildScene(input, webOnly);
    expect(runningMarks(scene, [], null).changed.size).toBe(0);
    expect(runningMarks(scene, [], null).areas.size).toBe(0);
    const stray = runningMarks(scene, [{ ...ADA, paths: ['README.md'] }], null);
    expect(stray.changed.size).toBe(0);
    expect(stray.areas.size).toBe(0);
    expect(NO_MARKS.perChat).toEqual([]);
  });
});

describe('the files to locate for the overlay', () => {
  const working = (id: string, projectId: string, paths: string[]): RunningChat => ({
    id,
    title: id,
    status: 'running',
    projectId,
    paths,
  });
  const chats = [
    working('a', 'p1', ['one.ts']),
    working('b', 'p2', ['two.ts']),
    working('c', 'p1', ['three.ts']),
  ];

  it('takes every chat of the first project when none is selected', () => {
    expect(wantedPaths(chats, null)).toEqual({ projectId: 'p1', paths: ['one.ts', 'three.ts'] });
  });

  it('follows the selected chat into its own project', () => {
    expect(wantedPaths(chats, 'b')).toEqual({ projectId: 'p2', paths: ['two.ts'] });
  });

  it('wants nothing when no chat is working', () => {
    expect(wantedPaths([], null)).toBeNull();
  });
});
