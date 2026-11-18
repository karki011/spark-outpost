import { ClientCapabilities } from '@agentclientprotocol/claude-agent-acp/dist/tool-calls/client-capabilities.js';
import { SessionBackgroundWork } from '@agentclientprotocol/claude-agent-acp/dist/v1/background-work.js';
import { describe, expect, it, vi } from 'vitest';
import { turnCapabilities } from './client-info.ts';

const TOOL_CALL = 'toolu_bash';

function followed(capabilities: unknown) {
  const getTaskOutput = vi.fn(async () => ({ output: 'partial\n' }));
  const owner = {
    query: { getTaskOutput },
    emittedToolCalls: new Set([TOOL_CALL]),
    toolUseCache: { [TOOL_CALL]: { name: 'Bash' } },
    liveBackgroundTasks: new Map(),
  };
  const send = vi.fn(async () => undefined);
  const work = new SessionBackgroundWork('root');
  work.followForeground(
    { task_id: 'task-1', task_type: 'local_bash', is_backgrounded: false, tool_use_id: TOOL_CALL },
    {
      owner,
      capabilities: ClientCapabilities.from(capabilities as never),
      send,
      logger: { log: vi.fn(), error: vi.fn() },
    },
  );
  const polling = work.foreground.size > 0;
  work.queryClosed();
  return { polling, send };
}

describe('the pinned Claude adapter streaming a foreground command', () => {
  it('streams to a client that appends terminal output and is not AIR', () => {
    expect(followed({ _meta: { terminal_output_delta: true } }).polling).toBe(true);
  });

  it('never streams to Spark, which declares AIR and no terminal output', () => {
    const spark = followed(turnCapabilities(true, true));
    expect(spark.polling).toBe(false);
    expect(spark.send).not.toHaveBeenCalled();
  });
});
