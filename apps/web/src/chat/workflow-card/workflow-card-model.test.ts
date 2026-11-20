import { describe, expect, it } from 'vitest';
import type {
  Approval,
  ConversationDetail,
  CrewMember,
  Orchestration,
  Run,
  WorkflowRun,
} from '@spark-outpost/contracts';
import {
  cardTurnIds,
  CARD_TURNS_MAX,
  currentStep,
  findingQuote,
  isWorkflowTurn,
  pendingApprovals,
  runFindings,
  severityCounts,
  shownOnCard,
} from './workflow-card-model.ts';

const member = (runId: string, step?: string): CrewMember =>
  ({
    runId,
    role: 'spark',
    name: `Spark ${runId}`,
    spark: { id: '00000000-0000-4000-8000-000000000001', role: 'r', only: true, step },
  }) as CrewMember;

const orchestration = (crew: CrewMember[]) =>
  ({ depthSource: 'user', crew }) as unknown as Orchestration;

function detail(runs: Partial<Run>[], orchestrations: Record<string, Orchestration> = {}) {
  return { runs: runs as Run[], orchestrations, approvals: [] } as unknown as ConversationDetail;
}

const step = (
  stepId: string,
  fields: Partial<WorkflowRun['steps'][number]> = {},
): WorkflowRun['steps'][number] => ({
  stepId,
  sparkId: '00000000-0000-4000-8000-000000000001',
  dependsOn: [],
  state: 'succeeded',
  runId: null,
  note: null,
  startedAt: null,
  finishedAt: null,
  ...fields,
});

const workflowRun = (fields: Partial<WorkflowRun>): WorkflowRun =>
  ({ status: 'succeeded', steps: [], ...fields }) as WorkflowRun;

describe('which turns are workflow turns', () => {
  it('counts turns a workflow started and turns with workflow steps, not plain Spark jobs', () => {
    const chat = detail(
      [{ id: 'a' }, { id: 'b', workflowStarted: true }, { id: 'c' }, { id: 'd' }],
      {
        c: orchestration([member('m1', 'review')]),
        d: orchestration([member('m2')]),
      },
    );
    expect(chat.runs.map((run) => isWorkflowTurn(chat, run))).toEqual([false, true, true, false]);
  });

  it('keeps the latest undismissed workflow turns for the card', () => {
    const runs = Array.from({ length: CARD_TURNS_MAX + 2 }, (_, index) => ({
      id: `t${index}`,
      workflowStarted: true,
    }));
    const ids = cardTurnIds(detail(runs), new Set([`t${CARD_TURNS_MAX + 1}`]));
    expect(ids).toEqual(['t1', 't2', 't3', 't4', 't5']);
  });
});

describe('findings on the card', () => {
  it('reads only the last steps, so a summary step does not double count', () => {
    const run = workflowRun({
      steps: [
        step('review', { note: '[High] token logged' }),
        step('summary', { dependsOn: ['review'], note: '[Low] naming\n[Critical] token logged' }),
      ],
    });
    expect(runFindings(run).map((finding) => finding.severity)).toEqual(['critical', 'low']);
    expect(severityCounts(runFindings(run))).toEqual([
      { severity: 'critical', count: 1 },
      { severity: 'low', count: 1 },
    ]);
  });

  it('quotes a finding with its severity for the composer', () => {
    expect(findingQuote({ severity: 'high', text: 'missing check' })).toBe('[High] missing check');
  });
});

describe('when a run stays on the card', () => {
  const chat = detail([{ id: 'w', workflowStarted: true }, { id: 'u' }]);
  const later = detail([
    { id: 'w', workflowStarted: true },
    { id: 'n', prFollowUp: true },
  ]);
  const clean = workflowRun({ steps: [step('review', { note: 'No findings.' })] });

  it('drops a clean finished run once you send another message', () => {
    expect(shownOnCard(clean, 'w', later, false)).toBe(true);
    expect(shownOnCard(clean, 'w', chat, false)).toBe(false);
  });

  it('keeps running, waiting, failed and findings runs until dismissed', () => {
    expect(shownOnCard({ ...clean, status: 'running' }, 'w', chat, false)).toBe(true);
    expect(shownOnCard(clean, 'w', chat, true)).toBe(true);
    expect(shownOnCard({ ...clean, status: 'failed' }, 'w', chat, false)).toBe(true);
    const found = workflowRun({ steps: [step('review', { note: '[Low] naming' })] });
    expect(shownOnCard(found, 'w', chat, false)).toBe(true);
  });
});

describe('the running step and waiting cards', () => {
  it('names the step that is running and its Spark', () => {
    const members = [member('r2', 'security')];
    const run = workflowRun({
      status: 'running',
      steps: [step('review'), step('security', { state: 'running', runId: 'r2' }), step('sum')],
    });
    expect(currentStep(run, members)).toBe('step 2 of 3 · Spark r2');
    expect(currentStep({ ...run, status: 'succeeded' }, members)).toBeNull();
  });

  it('finds pending cards for the workflow’s steps only', () => {
    const card = { status: 'pending', runId: 'r2' } as Approval;
    const members = [member('r2', 'security')];
    expect(pendingApprovals([card, { ...card, runId: 'x' }], members)).toEqual([card]);
    expect(pendingApprovals([{ ...card, status: 'allowed' } as Approval], members)).toEqual([]);
  });
});
