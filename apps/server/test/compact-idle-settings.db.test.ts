import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createConversation } from '../src/persistence/conversations.ts';
import { terminalLaunchSettings } from '../src/persistence/native-terminal-settings.ts';
import { getSetupState, sparkPreferences, updateProfile } from '../src/persistence/setup.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.cleanup();
});

it('keeps idle compaction off until the user turns it on, for chats and Terminal sessions', async () => {
  const conversationId = (await createConversation(t.db, t.workspaceId, randomUUID())).id;
  expect((await getSetupState(t.db, t.workspaceId)).profile.compactIdleConversations).toBe(false);
  expect((await sparkPreferences(t.db, t.workspaceId)).compactIdleConversations).toBe(false);
  expect((await terminalLaunchSettings(t.db, conversationId)).compactIdle).toBe(false);

  await updateProfile(t.db, t.workspaceId, { compactIdleConversations: true });
  await updateProfile(t.db, t.workspaceId, { displayName: 'Saved choice' });

  expect((await getSetupState(t.db, t.workspaceId)).profile.compactIdleConversations).toBe(true);
  expect((await sparkPreferences(t.db, t.workspaceId)).compactIdleConversations).toBe(true);
  expect(await terminalLaunchSettings(t.db, conversationId)).toEqual({
    recordLikeChat: true,
    compactIdle: true,
  });
});
