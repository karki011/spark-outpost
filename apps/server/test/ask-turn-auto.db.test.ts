import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InvolvementLevel } from '@spark-outpost/contracts';
import { ASK_AUTO_WHY } from '../src/approvals/decide.ts';
import { updateChatSettings } from '../src/persistence/chat-settings.ts';
import { createConversation } from '../src/persistence/conversations.ts';
import { askTurnAutoWhy } from '../src/workflow/ask-auto.ts';
import { connectCliProvider, createTestDb, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
  await connectCliProvider(t, 'claude');
});

afterEach(async () => {
  await t.cleanup();
});

const MODES = [
  { id: 'default', label: 'Manual', description: null, kind: null },
  { id: 'auto', label: 'Auto', description: null, kind: null },
];

async function whyFor(agentMode: string, level: InvolvementLevel, provider = 'claude') {
  const conversationId = randomUUID();
  await createConversation(t.db, t.workspaceId, conversationId);
  await updateChatSettings(t.db, conversationId, { agentMode, level });
  return askTurnAutoWhy({ db: t.db, conversationId, provider, modes: MODES });
}

describe('commands in an Ask turn', () => {
  it('run without asking in Auto mode at Review each step', async () => {
    expect(await whyFor('auto', 'balanced')).toBe('Auto mode');
  });

  it('run without asking in Auto mode at Automatic', async () => {
    expect(await whyFor('auto', 'hands-off')).toBe('Auto mode');
  });

  it('run without asking in Manual mode at Automatic', async () => {
    expect(await whyFor('default', 'hands-off')).toBe(ASK_AUTO_WHY);
  });

  it('ask in Manual mode at Review each step', async () => {
    expect(await whyFor('default', 'balanced')).toBeNull();
  });

  it('run without asking in Bypass permissions mode', async () => {
    expect(await whyFor('bypassPermissions', 'balanced')).toBe('bypassPermissions mode');
  });

  it("ignore another provider's mode", async () => {
    expect(await whyFor('auto', 'balanced', 'codex')).toBeNull();
  });
});
