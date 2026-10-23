import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { raiseRailFlag } from '../src/observations/raise-flag.ts';
import { createConversation } from '../src/persistence/conversations.ts';
import { listRailFlags } from '../src/persistence/rail-flags.ts';
import { createTestDb, type TestDb } from './support.ts';
import { sendMessage } from './turn-support.ts';

let t: TestDb;
let conversationId: string;
let runId: string;
let audited: { method: string; params: Record<string, unknown> }[];

const audit = {
  message: (_source: string, message: unknown) => {
    audited.push(message as { method: string; params: Record<string, unknown> });
  },
  stderr: () => undefined,
};

const crossing = {
  toolCallId: 'toolu_1',
  rail: 'browser_data' as const,
  paths: [],
  inside: false,
  originals: [],
};

beforeEach(async () => {
  t = await createTestDb();
  audited = [];
  conversationId = (await createConversation(t.db, t.workspaceId, randomUUID())).id;
  runId = await sendMessage(t, conversationId, 'Look around', { permission: 'do' });
});

afterEach(async () => {
  await t.cleanup();
});

describe("a rail crossing the agent's own rules stopped", () => {
  it('raises a flag when the action ran', async () => {
    await raiseRailFlag(t.db, runId, audit, { ...crossing, stopped: false });
    const flags = await listRailFlags(t.db, conversationId);
    expect(flags.map((flag) => flag.rail)).toEqual(['browser_data']);
    expect(audited.map((entry) => entry.method)).toEqual(['spark/rail_crossed']);
  });

  it('keeps only an audit entry when nothing ran', async () => {
    await raiseRailFlag(t.db, runId, audit, { ...crossing, stopped: true });
    expect(await listRailFlags(t.db, conversationId)).toEqual([]);
    expect(audited).toEqual([
      {
        method: 'spark/rail_stopped',
        params: { toolCallId: 'toolu_1', rail: 'browser_data', paths: [] },
      },
    ]);
  });
});
