import type {
  ConversationDetail,
  CrewMember,
  OrchestrationDecision,
} from '@spark-outpost/contracts';
import { describe, expect, it } from 'vitest';
import { crewAgents } from './crew-projection.ts';
import { checkpoint, member, orchestration } from './test-orchestration.ts';
import { doingLine, nextChatter, sceneChanges, trimChatter, type TvScene } from './tv-chatter.ts';
import { askText, decisionLine, pendingAsks, roleSubtitle } from './tv-scene.ts';

const BUILDER = '00000000-0000-4000-8000-0000000000a1';
const CRITIC = '00000000-0000-4000-8000-0000000000a3';

const critic = member({ runId: CRITIC, role: 'critic', name: 'Critic' });

function scene(
  crew: CrewMember[],
  decision: string | null = null,
  activity: Record<string, { name: string; done: boolean }[]> = {},
): TvScene {
  return { agents: crewAgents(orchestration({ crew }), activity), decision };
}

describe('Agent TV handoffs and chatter', () => {
  it('stays quiet on the first frame, so opening the TV never replays history', () => {
    const now = scene([member({ status: 'running', toolCalls: 1 })]);
    expect(sceneChanges(null, now)).toEqual({ handoffs: [], chatter: [] });
  });

  it('sends a packet out and announces the handoff when an agent is dispatched', () => {
    const before = scene([]);
    const after = scene([member({ status: 'running', toolCalls: 0 })]);
    expect(sceneChanges(before, after)).toEqual({
      handoffs: [{ agentId: BUILDER, direction: 'out' }],
      chatter: [{ agentId: 'jev', text: 'Over to Builder.', pinned: true }],
    });
  });

  it('treats a queued agent starting work as a dispatch', () => {
    const before = scene([member({ status: 'queued' })]);
    const after = scene([member({ status: 'running' })]);
    expect(sceneChanges(before, after).handoffs).toEqual([{ agentId: BUILDER, direction: 'out' }]);
  });

  it('narrates a new step from the real activity stream', () => {
    const running = member({ status: 'running', toolCalls: 2 });
    const before = scene([running], null, { [BUILDER]: [{ name: 'Read `a.ts`', done: false }] });
    const after = scene([running], null, {
      [BUILDER]: [
        { name: 'Read `a.ts`', done: true },
        { name: 'Edit `format.ts`', done: false },
      ],
    });
    expect(sceneChanges(before, after).chatter).toEqual([
      { agentId: BUILDER, text: 'Editing format.ts…', pinned: false },
    ]);
  });

  it("speaks the Critic's actual verdict", () => {
    const before = scene([{ ...critic, status: 'running', toolCalls: 1 }]);
    const good = scene([{ ...critic, verdict: 'looks_good' }]);
    const worried = scene([{ ...critic, verdict: 'concerns' }]);
    expect(sceneChanges(before, good).chatter).toEqual([
      { agentId: CRITIC, text: 'Looks good to me.', pinned: true },
    ]);
    expect(sceneChanges(before, worried).chatter).toEqual([
      { agentId: CRITIC, text: 'I have some concerns.', pinned: true },
    ]);
  });

  it('says when an agent hits a problem, and Jev shares a new decision', () => {
    const before = scene([member({ status: 'running', toolCalls: 1 })]);
    const after = scene([member({ status: 'failed' })], 'Picked plan → execute · 0.86');
    expect(sceneChanges(before, after).chatter).toEqual([
      { agentId: 'jev', text: 'Picked plan → execute · 0.86', pinned: false },
      { agentId: BUILDER, text: 'Hit a problem.', pinned: true },
    ]);
  });

  it('keeps handoffs and milestones in a burst and trims only the ordinary lines', () => {
    const line = (text: string, pinned = false) => ({ agentId: BUILDER, text, pinned });
    const burst = [
      line('Reading a.ts…'),
      line('Over to Builder.', true),
      line('Reading b.ts…'),
      line('Editing c.ts…'),
      line('Running pnpm test…'),
      line('Step done!', true),
      line('Checking d.ts…'),
    ];
    expect(trimChatter(burst, 3).map((item) => item.text)).toEqual([
      'Over to Builder.',
      'Editing c.ts…',
      'Running pnpm test…',
      'Step done!',
      'Checking d.ts…',
    ]);
    expect(trimChatter(burst.slice(0, 3), 3)).toEqual(burst.slice(0, 3));
  });

  it('skips lines from an agent whose question is showing, so they never hold up the rest', () => {
    const jev = (text: string) => ({ agentId: 'jev', text, pinned: true });
    const done = { agentId: CRITIC, text: 'Looks good to me.', pinned: true };
    const queue = [jev('Over to Critic.'), done, jev('Sent Critic: review')];
    expect(nextChatter(queue, new Set(['jev']))).toEqual({ line: done, rest: [] });
    expect(nextChatter(queue, new Set())).toEqual({ line: queue[0], rest: queue.slice(1) });
    expect(nextChatter([jev('Over to Critic.')], new Set(['jev']))).toEqual({
      line: null,
      rest: [],
    });
  });

  it('turns a step into something an agent would say', () => {
    expect(doingLine('run pnpm test')).toBe('Running pnpm test…');
    expect(doingLine('add a midnight test')).toBe('Adding a midnight test…');
    expect(doingLine('tidy the heading')).toBe('Tidy the heading…');
  });
});

const decision: OrchestrationDecision = {
  id: '00000000-0000-4000-8000-0000000000d1',
  kind: 'intake',
  role: null,
  stepIndex: null,
  childRunId: null,
  summary: 'plan → execute · edits',
  applied: 'jev',
  gate: {
    decision: 'act',
    confidence: 0.862,
    risk: 'edits',
    level: 'balanced',
    actAt: 0.7,
    askAt: 0.5,
    clarifyBelow: null,
  },
  jevStatus: 'answered',
  jevError: null,
  latencyMs: 900,
  tokens: 400,
  costUsd: 0.0001,
  answer: {},
  createdAt: '2026-09-26T10:02:01.000Z',
};

describe('Agent TV scene', () => {
  it("phrases Jev's last decision with its confidence", () => {
    expect(decisionLine(decision)).toBe('Picked plan → execute · edits · 0.86');
    expect(decisionLine({ ...decision, kind: 'route', role: 'builder', gate: null })).toBe(
      'Sent Builder: plan → execute · edits',
    );
    expect(decisionLine(undefined)).toBeNull();
  });

  it('asks in plain words what an agent needs from you', () => {
    const run = checkpoint({ kind: 'accept' }, { kind: 'execute', title: 'Run a command?' });
    run.payload.command = 'pnpm test';
    expect(askText(run)).toBe('Needs you: run pnpm test?');
    const edit = checkpoint({ kind: 'accept' }, { kind: 'edit', title: 'Change a file?' });
    edit.payload.paths = ['/repo/src/format.ts'];
    expect(askText(edit)).toBe('Needs you: change format.ts?');
    expect(askText(checkpoint({ kind: 'accept' }, { title: 'Keep these changes' }))).toBe(
      'Needs you: keep these changes?',
    );
  });

  it('pins each pending approval on the agent that asked, and checkpoints on Jev', () => {
    const waiting = member({ status: 'awaiting_approval' });
    const plan = checkpoint({ kind: 'accept' }, { title: 'Keep these changes' });
    const edit = checkpoint(
      { kind: 'accept' },
      { id: '00000000-0000-4000-8000-0000000000c2', runId: BUILDER, kind: 'edit' },
    );
    const stranger = checkpoint(
      { kind: 'accept' },
      { id: '00000000-0000-4000-8000-0000000000c3', runId: CRITIC },
    );
    const run = orchestration({ crew: [waiting], pendingCheckpoint: plan });
    const detail = { approvals: [edit, stranger] } as unknown as ConversationDetail;
    const asks = pendingAsks(detail, run, crewAgents(run));
    expect(Object.keys(asks).sort()).toEqual([BUILDER, 'jev']);
    expect(asks.jev).toEqual({ approvalId: plan.id, text: 'Needs you: keep these changes?' });
    expect(asks[BUILDER]!.approvalId).toBe(edit.id);
  });

  it('shows the role under a friendly name, and not under a role name', () => {
    expect(roleSubtitle({ role: 'builder', name: 'Bolt' })).toBe('Builder');
    expect(roleSubtitle({ role: 'builder', name: 'Builder 2' })).toBeNull();
    expect(roleSubtitle({ role: 'jev', name: 'Jev' })).toBeNull();
  });
});

describe('loop guard on Agent TV', () => {
  it('asks about a Builder that was repeating itself in plain words', () => {
    const stuck = checkpoint(
      { kind: 'stuck', agent: 'Bolt' },
      { kind: 'stuck', title: 'Bolt was repeating itself' },
    );
    expect(askText(stuck)).toBe('Needs you: Bolt was repeating itself');
  });
});
