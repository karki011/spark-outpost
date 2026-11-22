import { describe, expect, it } from 'vitest';
import type { WorkflowStep } from '@spark-outpost/contracts';
import {
  ANY_PROJECT,
  MIXED_PROJECTS,
  baselineOf,
  dirtyParts,
  draftOf,
  draftProblems,
  problemOf,
  saveDraft,
  saveFailureText,
  setWhere,
  toSchedule,
  toTriggers,
  unsavedChanges,
  whereValue,
  type SaveApi,
  type WorkflowDraft,
} from './workflow-draft.ts';

const today = new Date(2026, 10, 16, 10, 40);
const SPARK = '00000000-0000-4000-8000-000000000001';
const PROJECT = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000a2';

function step(id: string, dependsOn: string[] = []): WorkflowStep {
  return { id, sparkId: SPARK, prompt: '', dependsOn, join: 'all', onFailure: 'stop' };
}

const file = { name: 'Review', steps: [step('lint'), step('comment', ['lint'])] };
const saved = baselineOf(file, null, null, today);
const fresh = baselineOf(null, null, null, today);

function edited(change: (draft: WorkflowDraft) => WorkflowDraft): WorkflowDraft {
  return change(draftOf(saved, file));
}

function recordingApi(fail: Partial<Record<keyof SaveApi, string>> = {}) {
  const calls: string[] = [];
  const answer = (part: keyof SaveApi, value: { hash: string }) => {
    calls.push(part);
    return fail[part] ? Promise.reject(new Error(fail[part])) : Promise.resolve(value);
  };
  const api: SaveApi = {
    workflow: () => answer('workflow', { hash: 'hash-2' }),
    schedule: () => answer('schedule', { hash: '' }),
    triggers: () => answer('triggers', { hash: '' }),
  };
  return { api, calls };
}

describe('a workflow draft', () => {
  it('starts from the saved workflow with the schedule off and no trigger on', () => {
    const draft = draftOf(saved, file);
    expect(draft.schedule).toMatchObject({ enabled: false, every: '1', unit: 'days' });
    expect(draft.triggers).toMatchObject({ commit: false, debounceMinutes: '0' });
    expect(dirtyParts(saved, draft)).toEqual({ steps: false, schedule: false, triggers: false });
    expect(unsavedChanges(saved, draft)).toBe(0);
  });

  it('counts a new workflow as one change until it is saved', () => {
    const draft = draftOf(fresh, file);
    expect(dirtyParts(fresh, draft).steps).toBe(true);
    expect(unsavedChanges(fresh, draft)).toBe(1);
  });

  it('counts each changed step, schedule field and trigger', () => {
    const draft = edited((start) => ({
      name: 'Review twice',
      steps: [step('lint'), { ...step('comment', ['lint']), prompt: 'Be brief.' }, step('extra')],
      schedule: { ...start.schedule, enabled: true, every: '2' },
      triggers: { ...start.triggers, pullRequest: true },
    }));
    expect(dirtyParts(saved, draft)).toEqual({ steps: true, schedule: true, triggers: true });
    expect(unsavedChanges(saved, draft)).toBe(6);
  });

  it('counts a reorder and a removed step', () => {
    const reordered = edited((start) => ({ ...start, steps: [...file.steps].reverse() }));
    expect(unsavedChanges(saved, reordered)).toBe(1);
    const removed = edited((start) => ({ ...start, steps: [step('lint')] }));
    expect(unsavedChanges(saved, removed)).toBe(1);
  });

  it('turns the typed numbers into what the server stores', () => {
    const draft = edited((start) => ({
      ...start,
      schedule: { ...start.schedule, every: ' 30 ' },
      triggers: { ...start.triggers, debounceMinutes: '5', branchGlob: ' spark/* ' },
    }));
    expect(toSchedule(draft.schedule).every).toBe(30);
    expect(toTriggers(draft.triggers)).toMatchObject({ debounceMinutes: 5, branchGlob: 'spark/*' });
  });
});

describe('where', () => {
  it('shows one project for the schedule and the triggers and writes both', () => {
    const draft = draftOf(saved, file);
    expect(whereValue(draft)).toBe(ANY_PROJECT);
    const placed = setWhere(draft, PROJECT);
    expect(placed.schedule.projectId).toBe(PROJECT);
    expect(placed.triggers.projectId).toBe(PROJECT);
    expect(whereValue(placed)).toBe(PROJECT);
    expect(unsavedChanges(saved, placed)).toBe(1);
    expect(whereValue(setWhere(placed, null))).toBe(ANY_PROJECT);
  });

  it('says so when the two were saved with different projects, and keeps them until one is picked', () => {
    const draft = edited((start) => ({
      ...start,
      schedule: { ...start.schedule, projectId: PROJECT },
      triggers: { ...start.triggers, projectId: OTHER },
    }));
    expect(whereValue(draft)).toBe(MIXED_PROJECTS);
    expect(whereValue(setWhere(draft, OTHER))).toBe(OTHER);
  });
});

describe('validation', () => {
  it('has no problem for a saved workflow', () => {
    expect(draftProblems(draftOf(saved, file), 0)).toEqual([]);
  });

  it('asks for a name and a step on the Steps tab', () => {
    const problems = draftProblems({ ...draftOf(fresh, { name: ' ', steps: [] }) }, 0);
    expect(problems.map(({ field, tab }) => [field, tab])).toEqual([
      ['name', 'steps'],
      ['steps', 'steps'],
    ]);
    expect(problemOf(draftProblems(draftOf(saved, file), 2), 'steps')).toBe(
      'Fix 2 problems to save.',
    );
  });

  it('refuses Every and Wait values that are not whole numbers in range', () => {
    for (const every of ['', '0', '1.5', 'abc', '-3', '1001']) {
      const draft = edited((start) => ({ ...start, schedule: { ...start.schedule, every } }));
      expect(problemOf(draftProblems(draft, 0), 'every'), every).toBe(
        'Every takes a whole number from 1 to 1000.',
      );
    }
    for (const debounceMinutes of ['', '1.5', 'soon', '-1', '1441']) {
      const draft = edited((start) => ({
        ...start,
        triggers: { ...start.triggers, debounceMinutes },
      }));
      expect(problemOf(draftProblems(draft, 0), 'wait'), debounceMinutes).toBe(
        'Wait takes a whole number of minutes from 0 to 1440.',
      );
    }
    const fine = edited((start) => ({
      ...start,
      schedule: { ...start.schedule, every: '1000' },
      triggers: { ...start.triggers, debounceMinutes: '1440' },
    }));
    expect(draftProblems(fine, 0)).toEqual([]);
  });

  it('checks the hours only for minutes and hours, and the branch pattern only with the commit trigger on', () => {
    const backwards = edited((start) => ({
      ...start,
      schedule: { ...start.schedule, unit: 'hours', from: '18:00', to: '09:00' },
      triggers: { ...start.triggers, branchGlob: 'a..b' },
    }));
    expect(draftProblems(backwards, 0).map((problem) => [problem.field, problem.tab])).toEqual([
      ['hours', 'when'],
    ]);
    const daily = { ...backwards, schedule: { ...backwards.schedule, unit: 'days' as const } };
    expect(draftProblems(daily, 0)).toEqual([]);
    const onCommit = { ...daily, triggers: { ...daily.triggers, commit: true } };
    expect(problemOf(draftProblems(onCommit, 0), 'branch')).toMatch(/^a\.\.b can never match/);
  });
});

describe('saving', () => {
  it('writes a new workflow first, then its schedule and triggers, in one save', async () => {
    const draft = {
      ...draftOf(fresh, file),
      schedule: { ...fresh.schedule, enabled: true },
      triggers: { ...fresh.triggers, pullRequest: true },
    };
    const { api, calls } = recordingApi();
    const outcome = await saveDraft('review', draft, fresh, null, api);
    expect(calls).toEqual(['workflow', 'schedule', 'triggers']);
    expect(outcome).toMatchObject({ hash: 'hash-2', failed: [], skipped: [] });
    expect(dirtyParts(outcome.baseline, draft)).toEqual({
      steps: false,
      schedule: false,
      triggers: false,
    });
    expect(saveFailureText(outcome)).toBeNull();
  });

  it('writes only the parts that changed', async () => {
    const draft = edited((start) => ({
      ...start,
      triggers: { ...start.triggers, commit: true },
    }));
    const { api, calls } = recordingApi();
    const outcome = await saveDraft('review', draft, saved, 'hash-1', api);
    expect(calls).toEqual(['triggers']);
    expect(outcome.hash).toBe('hash-1');
  });

  it('stops when the steps do not save and says the rest was not tried', async () => {
    const draft = edited((start) => ({
      ...start,
      name: 'Renamed',
      schedule: { ...start.schedule, enabled: true },
      triggers: { ...start.triggers, commit: true },
    }));
    const { api, calls } = recordingApi({ workflow: 'This workflow changed somewhere else.' });
    const outcome = await saveDraft('review', draft, saved, 'hash-1', api);
    expect(calls).toEqual(['workflow']);
    expect(outcome.hash).toBe('hash-1');
    expect(outcome.baseline).toBe(saved);
    expect(saveFailureText(outcome)).toBe(
      'The steps didn’t save: This workflow changed somewhere else. The schedule and the triggers were not tried. Your changes are still here.',
    );
  });

  it('keeps what saved and names the part that did not', async () => {
    const draft = edited((start) => ({
      ...start,
      name: 'Renamed',
      schedule: { ...start.schedule, enabled: true },
      triggers: { ...start.triggers, commit: true },
    }));
    const { api, calls } = recordingApi({ schedule: 'That project is not in Spark' });
    const outcome = await saveDraft('review', draft, saved, 'hash-1', api);
    expect(calls).toEqual(['workflow', 'schedule', 'triggers']);
    expect(outcome.hash).toBe('hash-2');
    expect(dirtyParts(outcome.baseline, draft)).toEqual({
      steps: false,
      schedule: true,
      triggers: false,
    });
    expect(saveFailureText(outcome)).toBe(
      'The schedule didn’t save: That project is not in Spark. The steps and the triggers are saved. Your changes are still here.',
    );
  });
});
