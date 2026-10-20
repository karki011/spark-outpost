import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import { createBackgroundWork, endsAgentCycle } from './background-work.ts';
import { createSubagentRouter } from './subagent-stream.ts';

const ROOT = 'root';

function feed(messages: { sessionId: string; update: Record<string, unknown> }[]) {
  const route = createSubagentRouter();
  const work = createBackgroundWork();
  for (const { sessionId, update } of messages) {
    const routed = route({ method: 'session/update', params: { sessionId, update } }) as {
      params: { update: SessionUpdate };
    } | null;
    if (routed) work.see(routed.params.update);
  }
  return work;
}

const spawned = (id: string, name: string) => ({
  sessionId: ROOT,
  update: { sessionUpdate: 'subagent_spawned', subagentSessionId: id, name, task: 't' },
});
const ended = (id: string) => ({
  sessionId: ROOT,
  update: { sessionUpdate: 'subagent_state_update', subagentSessionId: id, state: 'completed' },
});
const task = (id: string, name: string) => ({
  sessionId: ROOT,
  update: { sessionUpdate: 'async_task_spawned', asyncTaskId: id, name },
});
const taskEnded = (id: string, state = 'completed') => ({
  sessionId: ROOT,
  update: { sessionUpdate: 'async_task_state_update', asyncTaskId: id, state },
});
const backgrounded = (subagent: string, taskId: string) => ({
  sessionId: subagent,
  update: {
    sessionUpdate: 'tool_call_update',
    toolCallId: `call-${taskId}`,
    _meta: { claudeCode: { toolResponse: { backgroundTaskId: taskId } } },
  },
});

describe('background work', () => {
  it('counts a finished sub-agent as busy while a shell it started still runs', () => {
    const work = feed([
      spawned('a', 'Schema'),
      task('t1', 'sleep 60'),
      backgrounded('a', 't1'),
      ended('a'),
    ]);
    expect(work.count()).toEqual({ agents: 1, tasks: 0, names: ['Schema'] });
  });

  it('counts the main agent’s own shells as tasks and drops them when they end', () => {
    const work = feed([task('t1', 'npm test'), task('t2', 'sleep 5'), taskEnded('t1', 'failed')]);
    expect(work.count()).toEqual({ agents: 0, tasks: 1, names: ['sleep 5'] });
    expect(feed([task('t1', 'npm test'), taskEnded('t1', 'stopped')]).busy()).toBe(false);
  });

  it('folds a resumed generation into the sub-agent it continues', () => {
    const work = feed([spawned('a', 'Schema'), ended('a'), spawned('a:generation:2', 'Schema')]);
    expect(work.count()).toEqual({ agents: 1, tasks: 0, names: ['Schema'] });
    expect(feed([spawned('a', 'Schema'), ended('a')]).busy()).toBe(false);
  });

  it('ignores task progress that does not end the task', () => {
    const work = feed([
      task('t1', 'watch'),
      {
        sessionId: ROOT,
        update: { sessionUpdate: 'async_task_state_update', asyncTaskId: 't1', state: 'running' },
      },
    ]);
    expect(work.busy()).toBe(true);
  });
});

describe('the end of an agent cycle', () => {
  it('is the usage update that names the cycle’s origin', () => {
    const usage = { sessionUpdate: 'usage_update', used: 1, size: 2 } as const;
    expect(
      endsAgentCycle({ ...usage, _meta: { '_claude/origin': { kind: 'task-notification' } } }),
    ).toBe(true);
    expect(endsAgentCycle(usage)).toBe(false);
  });
});
