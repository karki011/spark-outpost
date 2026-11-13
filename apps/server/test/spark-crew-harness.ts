import { afterEach, beforeEach } from 'vitest';
import type { Teammate } from '@spark-outpost/contracts';
import { newSpark, useWorkflowsDir } from './crew-workflow-support.ts';
import {
  recordedHooks,
  startSparkTools,
  type RecordedHooks,
  type SparkToolsHarness,
} from './spark-mcp-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

export interface CrewToolsState {
  t: TestDb;
  recorded: RecordedHooks;
  chat: { conversationId: string; runId: string };
  scout: Teammate;
}

export interface CrewToolsHarness {
  state(): CrewToolsState;
  setRun(mode: string, source?: string): Promise<void>;
  call(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<{ text: string; isError: boolean; facts: Record<string, unknown> }>;
}

export const NOTES_SKILL_TEXT =
  '---\nname: notes\ndescription: Write release notes from merged pull requests\n---\nSteps.\n';

export const NOTES_SKILL = {
  spark: 'Scout',
  files: [
    { path: 'skills/notes/SKILL.md', text: NOTES_SKILL_TEXT },
    { path: 'skills/notes/run.sh', text: 'gh pr list --state merged\n' },
  ],
};

export function useCrewTools(): CrewToolsHarness {
  let current: CrewToolsState;
  let tools: SparkToolsHarness;
  let cleanWorkflows: () => Promise<void>;

  const setRun = async (mode: string, source = 'ui') => {
    await current.t.db.query(
      `UPDATE runs SET provider = 'claude', agent_mode = $2, used_mode = $2, source = $3
       WHERE id = $1`,
      [current.chat.runId, mode, source],
    );
  };

  beforeEach(async () => {
    cleanWorkflows = await useWorkflowsDir();
    const t = await createTestDb();
    const recorded = recordedHooks();
    const chat = await startChat(t, 'Give Scout a release notes skill');
    const scout = await newSpark(t, 'Scout', { instructions: 'Be brief.' });
    current = { t, recorded, chat, scout };
    await setRun('bypassPermissions');
    tools = await startSparkTools(t, {
      conversationId: chat.conversationId,
      runId: chat.runId,
      actions: recorded.hooks,
    });
  });

  afterEach(async () => {
    current.recorded.stop();
    await tools.close();
    await current.t.cleanup();
    await cleanWorkflows();
  });

  return {
    state: () => current,
    setRun,
    async call(name, args = {}) {
      const result = await tools.call(name, args);
      return { ...result, facts: result.isError ? {} : result.json() };
    },
  };
}
