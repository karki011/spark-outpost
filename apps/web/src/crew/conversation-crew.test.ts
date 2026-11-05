import { describe, expect, it } from 'vitest';
import type { ConversationDetail, Orchestration } from '@spark-outpost/contracts';
import { storedCrew, tvCast, tvCrew } from './conversation-crew.ts';
import { member, orchestration } from './test-orchestration.ts';
import { RUN_ID, run } from './test-run.ts';

const SPARK_RUN = '00000000-0000-4000-8000-0000000000b1';

function detail(orchestrations: Record<string, Orchestration> = {}): ConversationDetail {
  return {
    conversation: { latestRun: null },
    runs: [run({ status: 'running', finishedAt: null })],
    orchestrations,
    approvals: [],
    activity: {},
  } as unknown as ConversationDetail;
}

const sparkJob = orchestration({
  depth: 'direct',
  depthSource: 'user',
  crew: [
    member({
      runId: SPARK_RUN,
      role: 'spark',
      name: 'Quill',
      status: 'running',
      toolCalls: 2,
      spark: { id: '00000000-0000-4000-8000-0000000000b2', role: 'Reviewer', only: false },
    }),
  ],
});

const oldCrew = orchestration({
  status: 'succeeded',
  crew: [member({ name: 'Bolt' }), member({ name: 'Hawk', role: 'critic', runId: SPARK_RUN })],
});

describe('who Agent TV shows', () => {
  it("shows the chat's one agent for a turn with no helpers", () => {
    expect(tvCrew(detail()).map((agent) => [agent.name, agent.state])).toEqual([
      ['Claude', 'thinking'],
    ]);
  });

  it("carries the agent's own sub-agents and the count it waits on", () => {
    const subagent = {
      id: 's1',
      name: 'Explore',
      task: 'Find the routes',
      parentId: null,
      state: 'working',
      step: null,
      startedAt: null,
      endedAt: null,
    };
    const cast = tvCast({
      ...detail(),
      conversation: { latestRun: { id: RUN_ID, waitingOn: 1 } },
      subagents: { [RUN_ID]: [subagent] },
    } as unknown as ConversationDetail)!;
    expect(cast.subagents).toEqual([subagent]);
    expect(cast.lead.line).toBe('waiting on 1 sub-agent');
    expect(tvCast(detail())!.subagents).toEqual([]);
  });

  it('adds a Spark that was handed a job, after the agent', () => {
    const cast = tvCast(detail({ [RUN_ID]: sparkJob }))!;
    expect(cast.lead.id).toBe(RUN_ID);
    expect(cast.sparks.map((spark) => [spark.agent.name, spark.agent.spark?.role])).toEqual([
      ['Quill', 'Reviewer'],
    ]);
  });

  it('shows no Coordinator, Critic or Jev for a stored crew turn', () => {
    expect(tvCrew(detail({ [RUN_ID]: oldCrew })).map((agent) => agent.name)).toEqual(['Claude']);
  });

  it('marks the agent as waiting while one of its cards is open', () => {
    const asking = {
      ...detail(),
      approvals: [{ id: 'a', runId: RUN_ID, status: 'pending' }],
    } as unknown as ConversationDetail;
    expect(tvCrew(asking)[0]!.state).toBe('waiting');
  });

  it('shows nothing before the first message', () => {
    expect(tvCrew({ ...detail(), runs: [] })).toEqual([]);
    expect(tvCrew(undefined)).toEqual([]);
  });
});

describe('the stored crew the Crew tab lists', () => {
  it('is a crew turn from before, never a Spark job or a plain turn', () => {
    expect(storedCrew(detail({ [RUN_ID]: oldCrew }))?.runId).toBe(RUN_ID);
    expect(storedCrew(detail({ [RUN_ID]: sparkJob }))).toBeNull();
    expect(storedCrew(detail())).toBeNull();
  });
});
