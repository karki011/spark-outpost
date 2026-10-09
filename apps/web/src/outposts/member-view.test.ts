import { describe, expect, it } from 'vitest';
import { memberDetails, memberViews, membersLabel } from './member-view.ts';
import { API_CHAT, DOCS_CHAT, FE_CHAT, WEB_PROJECT, chat, member } from './test-fixtures.ts';

const RUN = '0e000000-0000-4000-8000-000000000001';

function run(status: 'queued' | 'running' | 'succeeded' | 'failed' | 'outcome_unknown') {
  return { id: RUN, status, error: null, step: null, provider: 'codex', progress: null };
}

describe('memberViews', () => {
  it('lists members in their order with the chat title, project, branch and agent', () => {
    const views = memberViews(
      [member(API_CHAT, 'api', 2), member(FE_CHAT, 'fe', 1)],
      [
        chat(FE_CHAT, {
          title: 'Usage page',
          projectIds: [WEB_PROJECT],
          branch: 'spark/usage-filter',
          latestRun: run('succeeded'),
        }),
        chat(API_CHAT, { title: 'Usage endpoint' }),
      ],
      { [WEB_PROJECT]: 'web' },
    );
    expect(views.map((view) => view.handle)).toEqual(['fe', 'api']);
    expect(views[0]).toMatchObject({
      title: 'Usage page',
      place: 'web · spark/usage-filter',
      agent: 'Codex',
      state: 'idle',
      stateLabel: 'Idle',
    });
    expect(views[1]).toMatchObject({ place: '', agent: null });
    expect(memberDetails(views[0]!)).toBe('Usage page · web · spark/usage-filter · Codex');
  });

  it('shows each state as a word', () => {
    const states = (overrides: Parameters<typeof chat>[1]) =>
      memberViews([member(FE_CHAT, 'fe', 1)], [chat(FE_CHAT, overrides)], {})[0]?.stateLabel;
    expect(states({ latestRun: run('running') })).toBe('Working');
    expect(states({ latestRun: run('queued') })).toBe('Working');
    expect(states({ needsInput: true, latestRun: run('running') })).toBe('Needs you');
    expect(states({ latestRun: { ...run('succeeded'), needsYou: 'Light or dark?' } })).toBe(
      'Needs you',
    );
    expect(states({ latestRun: run('failed') })).toBe('Failed');
    expect(states({ latestRun: run('outcome_unknown') })).toBe('Failed');
    expect(states({ archivedAt: '2026-10-09T11:00:00.000Z', latestRun: run('running') })).toBe(
      'Archived',
    );
  });

  it('falls back to the handle while the chat is not in the list', () => {
    const [view] = memberViews([member(DOCS_CHAT, 'docs', 1)], [], {});
    expect(view).toMatchObject({ title: '@docs', state: 'idle', archived: false });
  });
});

describe('membersLabel', () => {
  it('counts the chats beside the user', () => {
    expect(membersLabel(0)).toBe('No chats yet');
    expect(membersLabel(1)).toBe('You and 1 chat');
    expect(membersLabel(3)).toBe('You and 3 chats');
  });
});
