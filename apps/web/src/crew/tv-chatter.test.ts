import type {
  ConversationDetail,
  CrewMember,
  OrchestrationDecision,
} from '@spark-outpost/contracts';
import { describe, expect, it } from 'vitest';
import { crewAgents } from './crew-projection.ts';
import { checkpoint, member, orchestration } from './test-orchestration.ts';
import { doingLine, sceneChanges, type TvScene } from './tv-chatter.ts';
import { askText, decisionLine, pendingAsks, roleSubtitle } from './tv-scene.ts';

const BUILDER = '00000000-0000-4000-8000-0000000000a1';
const ARCHITECT = '00000000-0000-4000-8000-0000000000a2';
const CRITIC = '00000000-0000-4000-8000-0000000000a3';

const architect = member({ runId: ARCHITECT, role: 'architect', name: 'Architect' });
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
    const before = scene([architect]);
    const after = scene([architect, member({ status: 'running', toolCalls: 0 })]);
    expect(sceneChanges(before, after)).toEqual({
      handoffs: [{ agentId: BUILDER, direction: 'out' }],
      chatter: [{ agentId: 'jev', text: 'Over to Builder.' }],
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
      { agentId: BUILDER, text: 'Editing format.ts…' },
    ]);
  });

  it('returns a packet to Jev and cheers when the plan is ready', () => {
    const before = scene([{ ...architect, status: 'running', toolCalls: 1 }]);
    const after = scene([architect]);
    expect(sceneChanges(before, after)).toEqual({
      handoffs: [{ agentId: ARCHITECT, direction: 'in' }],
      chatter: [{ agentId: ARCHITECT, text: 'Plan ready!' }],
    });
  });

  it("speaks the Critic's actual verdict", () => {
    const before = scene([{ ...critic, status: 'running', toolCalls: 1 }]);
    const good = scene([{ ...critic, verdict: 'looks_good' }]);
    const worried = scene([{ ...critic, verdict: 'concerns' }]);
    expect(sceneChanges(before, good).chatter).toEqual([
      { agentId: CRITIC, text: 'Looks good to me.' },
    ]);
    expect(sceneChanges(before, worried).chatter).toEqual([
      { agentId: CRITIC, text: 'I have some concerns.' },
    ]);
  });

  it('says when an agent hits a problem, and Jev shares a new decision', () => {
    const before = scene([member({ status: 'running', toolCalls: 1 })]);
    const after = scene([member({ status: 'failed' })], 'Picked plan → execute · 0.86');
    expect(sceneChanges(before, after).chatter).toEqual([
      { agentId: 'jev', text: 'Picked plan → execute · 0.86' },
      { agentId: BUILDER, text: 'Hit a problem.' },
    ]);
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
    const run = checkpoint({ kind: 'plan' }, { kind: 'execute', title: 'Run a command?' });
    run.payload.command = 'pnpm test';
    expect(askText(run)).toBe('Needs you: run pnpm test?');
    const edit = checkpoint({ kind: 'plan' }, { kind: 'edit', title: 'Change a file?' });
    edit.payload.paths = ['/repo/src/format.ts'];
    expect(askText(edit)).toBe('Needs you: change format.ts?');
    expect(askText(checkpoint({ kind: 'plan' }, { title: 'Approve the plan' }))).toBe(
      'Needs you: approve the plan?',
    );
  });

  it('pins each pending approval on the agent that asked, and checkpoints on Jev', () => {
    const waiting = member({ status: 'awaiting_approval' });
    const plan = checkpoint({ kind: 'plan' }, { title: 'Approve the plan' });
    const edit = checkpoint(
      { kind: 'plan' },
      { id: '00000000-0000-4000-8000-0000000000c2', runId: BUILDER, kind: 'edit' },
    );
    const stranger = checkpoint(
      { kind: 'plan' },
      { id: '00000000-0000-4000-8000-0000000000c3', runId: CRITIC },
    );
    const run = orchestration({ crew: [waiting], pendingCheckpoint: plan });
    const detail = { approvals: [edit, stranger] } as unknown as ConversationDetail;
    const asks = pendingAsks(detail, run, crewAgents(run));
    expect(Object.keys(asks).sort()).toEqual([BUILDER, 'jev']);
    expect(asks.jev).toEqual({ approvalId: plan.id, text: 'Needs you: approve the plan?' });
    expect(asks[BUILDER]!.approvalId).toBe(edit.id);
  });

  it('shows the role under a friendly name, and not under a role name', () => {
    expect(roleSubtitle({ role: 'builder', name: 'Bolt' })).toBe('Builder');
    expect(roleSubtitle({ role: 'builder', name: 'Builder 2' })).toBeNull();
    expect(roleSubtitle({ role: 'jev', name: 'Jev' })).toBeNull();
  });
});
