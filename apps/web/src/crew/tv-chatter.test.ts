import type { ConversationDetail } from '@spark-outpost/contracts';
import { describe, expect, it } from 'vitest';
import { chatAgent } from './chat-agent.ts';
import type { CrewAgent } from './crew-model.ts';
import { checkpoint } from './test-orchestration.ts';
import { RUN_ID, run } from './test-run.ts';
import { doingLine, nextChatter, sceneChatter, trimChatter } from './tv-chatter.ts';
import { askText, pendingAsks, roleSubtitle } from './tv-scene.ts';

const SPARK = '00000000-0000-4000-8000-0000000000b1';

const working = (step: string) =>
  chatAgent(run({ status: 'running', finishedAt: null }), [{ name: step, done: false }]);

function spark(state: CrewAgent['state']): CrewAgent {
  return { ...working('Read the notes'), id: SPARK, role: 'spark', name: 'Quill', state };
}

describe('Agent TV chatter', () => {
  it('stays quiet on the first frame, so opening the TV never replays history', () => {
    expect(sceneChatter(null, [working('Read the notes')])).toEqual([]);
  });

  it('narrates a new step from the real activity stream', () => {
    expect(sceneChatter([working('Read the notes')], [working('Run `pnpm test`')])).toEqual([
      { agentId: RUN_ID, text: 'Running pnpm test…', pinned: false },
    ]);
  });

  it("says when the chat's agent is done, when a Spark is, and when one hits a problem", () => {
    const before = [working('Read the notes'), spark('working')];
    const after = [chatAgent(run()), spark('done')];
    expect(sceneChatter(before, after).map((line) => line.text)).toEqual([
      'All done. Ready for you!',
      'Step done!',
    ]);
    expect(sceneChatter(before, [chatAgent(run({ status: 'failed' }))])).toEqual([
      { agentId: RUN_ID, text: 'Hit a problem.', pinned: true },
    ]);
  });

  it('keeps milestones in a burst and trims only the ordinary lines', () => {
    const plain = (text: string) => ({ agentId: RUN_ID, text, pinned: false });
    const done = { agentId: RUN_ID, text: 'Step done!', pinned: true };
    const queue = [plain('a'), plain('b'), done, plain('c')];
    expect(trimChatter(queue, 2).map((line) => line.text)).toEqual(['b', 'Step done!', 'c']);
  });

  it('skips lines from an agent whose question is showing, so they never hold up the rest', () => {
    const lead = { agentId: RUN_ID, text: 'Reading…', pinned: false };
    const done = { agentId: SPARK, text: 'Step done!', pinned: true };
    expect(nextChatter([lead, done], new Set([RUN_ID]))).toEqual({ line: done, rest: [] });
    expect(nextChatter([lead, done], new Set())).toEqual({ line: lead, rest: [done] });
  });

  it('turns a step into something an agent would say', () => {
    expect(doingLine('run pnpm test')).toBe('Running pnpm test…');
    expect(doingLine('add a midnight test')).toBe('Adding a midnight test…');
    expect(doingLine('tidy the heading')).toBe('Tidy the heading…');
  });
});

describe('what Agent TV says needs the user', () => {
  it('asks in plain words what an agent needs from you', () => {
    const command = checkpoint({ kind: 'accept' }, { kind: 'execute', title: 'Run a command?' });
    command.payload.command = 'pnpm test';
    expect(askText(command)).toBe('Needs you: run pnpm test?');
    const edit = checkpoint({ kind: 'accept' }, { kind: 'edit', title: 'Change a file?' });
    edit.payload.paths = ['/repo/src/format.ts'];
    expect(askText(edit)).toBe('Needs you: change format.ts?');
  });

  it('pins each pending card on the agent that asked and ignores other runs', () => {
    const edit = checkpoint({ kind: 'accept' }, { runId: RUN_ID, kind: 'edit' });
    const stranger = checkpoint(
      { kind: 'accept' },
      { id: '00000000-0000-4000-8000-0000000000c3', runId: SPARK },
    );
    const detail = { approvals: [edit, stranger] } as unknown as ConversationDetail;
    const asks = pendingAsks(detail, [chatAgent(run())]);
    expect(Object.keys(asks)).toEqual([RUN_ID]);
    expect(asks[RUN_ID]!.approvalId).toBe(edit.id);
  });

  it("shows a Spark's role under its name and nothing under the chat's agent", () => {
    const quill = { ...spark('working'), spark: { id: 's', role: 'Reviewer' } };
    expect(roleSubtitle(quill)).toBe('Reviewer');
    expect(roleSubtitle(chatAgent(run()))).toBeNull();
  });
});
