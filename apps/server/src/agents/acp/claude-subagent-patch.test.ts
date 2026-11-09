import { describe, expect, it } from 'vitest';
import { NativeSubagentRuntime } from '@agentclientprotocol/claude-agent-acp/dist/native-subagents.js';

interface Published {
  sessionId: string;
  update: Record<string, unknown>;
}

interface Report {
  usage?: Record<string, number>;
  summary?: string;
}

interface PatchedRuntime {
  taskStarted(task: Record<string, string>, deliver: () => Promise<void>): Promise<void>;
  noteProgress(taskId: string, usage: Record<string, number>): void;
  finishTask(
    taskId: string,
    status: string,
    deliver: () => Promise<void>,
    toolUseId?: string,
    report?: Report,
  ): Promise<void>;
}

function runtime() {
  const published: Published[] = [];
  const publish = async (notification: Published) => {
    published.push(notification);
  };
  const logger = { log: () => undefined, error: () => undefined };
  const built = new NativeSubagentRuntime('air', 'root', {} as never, publish as never, logger);
  const subagents = built as unknown as PatchedRuntime;
  const deliver = async () => undefined;
  const started = () =>
    subagents.taskStarted(
      { taskId: 't1', subagentType: 'Explore', description: 'Find routes', prompt: 'Find them' },
      deliver,
    );
  return { subagents, published, deliver, started };
}

const usage = { total_tokens: 3400, tool_uses: 7, duration_ms: 41_000 };

describe('the claude-agent-acp patch for sub-agent usage', () => {
  it('ends a sub-agent with the usage and summary of its task notification', async () => {
    const { subagents, published, deliver, started } = runtime();
    await started();
    await subagents.finishTask('t1', 'completed', deliver, undefined, {
      usage,
      summary: 'Found 4',
    });
    expect(published.at(-1)?.update).toEqual({
      sessionUpdate: 'subagent_state_update',
      subagentSessionId: 't1',
      state: 'completed',
      _meta: { claudeCode: { usage, summary: 'Found 4' } },
    });
  });

  it('carries the last progress reading when the task ends without a notification', async () => {
    const { subagents, published, deliver, started } = runtime();
    await started();
    subagents.noteProgress('t1', usage);
    await subagents.finishTask('t1', 'killed', deliver);
    expect(published.at(-1)?.update).toMatchObject({
      state: 'cancelled',
      _meta: { claudeCode: { usage } },
    });
  });

  it('sends the notification figures after an earlier end, without ending it twice', async () => {
    const { subagents, published, deliver, started } = runtime();
    await started();
    await subagents.finishTask('t1', 'completed', deliver);
    expect(published.at(-1)?.update).toEqual({
      sessionUpdate: 'subagent_state_update',
      subagentSessionId: 't1',
      state: 'completed',
    });
    await subagents.finishTask('t1', 'completed', deliver, undefined, { usage, summary: 'Done' });
    expect(published).toHaveLength(3);
    expect(published.at(-1)?.update).toMatchObject({
      state: 'completed',
      _meta: { claudeCode: { usage, summary: 'Done' } },
    });
    await subagents.finishTask('t1', 'completed', deliver);
    expect(published).toHaveLength(3);
  });
});
