import { describe, expect, it } from 'vitest';
import { DOCS_CHAT, FE_CHAT, OUTPOST_ID, WEB_PROJECT, chat } from '../test-fixtures.ts';
import { withoutChat } from './create-draft.ts';
import {
  API_PROJECT,
  countingIds,
  draftOf,
  existing,
  fresh,
  storyDraft,
  withTask,
} from './create-fixtures.ts';
import {
  afterChoices,
  leadHandle,
  orderLine,
  pullHint,
  pullLabel,
  pullLine,
  stackParent,
  storyStartLines,
  unpushedParent,
} from './story-draft.ts';

const CHATS = [
  chat(DOCS_CHAT, { title: 'Checkout plan', projectIds: [WEB_PROJECT] }),
  chat(FE_CHAT, { title: 'Usage page', projectIds: [API_PROJECT] }),
];

function story() {
  const ids = countingIds();
  const lead = existing(ids, DOCS_CHAT, 'lead');
  const api = withTask(fresh(ids, API_PROJECT, 'api'), 'Add the endpoint.');
  const fe = withTask(fresh(ids, API_PROJECT, 'fe'), 'Call it.', api.key);
  const docs = withTask(fresh(ids, WEB_PROJECT, 'docs'), 'Document it.', api.key);
  return { lead, api, fe, docs, draft: storyDraft([lead, api, fe, docs], DOCS_CHAT) };
}

describe('the story fields of the create sheet', () => {
  it('offers no starts-after choice in a sheet opened by hand', () => {
    const ids = countingIds();
    const fe = existing(ids, FE_CHAT, 'fe');
    expect(afterChoices(draftOf([fe, fresh(ids, API_PROJECT, 'api')]), fe)).toBeNull();
  });

  it('offers every other sub-task, never the chat itself or the proposing chat', () => {
    const { draft, lead, api, fe, docs } = story();
    expect(afterChoices(draft, fe)).toEqual([
      { key: api.key, handle: 'api' },
      { key: docs.key, handle: 'docs' },
    ]);
    expect(afterChoices(draft, lead)).toBeNull();
  });

  it('stacks on the parent only in the same project', () => {
    const { draft, api, fe, docs } = story();
    expect(stackParent(draft, fe, CHATS)?.key).toBe(api.key);
    expect(stackParent(draft, docs, CHATS)).toBeNull();
    expect(orderLine(draft, api, CHATS)).toBe('Starts right away');
    expect(orderLine(draft, fe, CHATS)).toBe('Starts after @api · stacked on its branch');
    expect(orderLine(draft, docs, CHATS)).toBe('Starts after @api · different repo, order only');
  });

  it('stacks a new chat on an existing chat of the same project', () => {
    const ids = countingIds();
    const old = withTask(existing(ids, FE_CHAT, 'old'), 'Start here.');
    const next = withTask(fresh(ids, API_PROJECT, 'next'), 'Go on.', old.key);
    const draft = storyDraft([existing(ids, DOCS_CHAT, 'lead'), old, next], DOCS_CHAT);
    expect(stackParent(draft, next, CHATS)?.key).toBe(old.key);
  });

  it('says what the pull request of a new chat targets', () => {
    const { draft, api, fe, lead } = story();
    expect(pullLine(draft, api, CHATS, 'full-auto')).toBe('Pull request, parallel');
    expect(pullLine(draft, fe, CHATS, 'full-auto')).toBe('Pull request, stacked on @api');
    expect(pullLine(draft, { ...fe, level: 'hands-off' }, CHATS, 'full-auto')).toBe(
      'No pull request',
    );
    expect(pullLine(draft, fe, CHATS, 'hands-off')).toBe('No pull request');
    expect(pullLine(draft, lead, CHATS, 'full-auto')).toBeNull();
    expect(pullLabel('full-auto', null)).toBe('Pull request, parallel');
    expect(pullHint('full-auto', 'api')).toBe("Full auto → PR: targets @api's branch");
    expect(pullHint('hands-off', 'api')).toBe('Automatic: keeps the changes on its branch');
  });

  it('warns when a stacked chat would push before its parent ever does', () => {
    const { lead, api, fe } = story();
    const quiet = { ...api, level: 'hands-off' as const };
    const draft = storyDraft([lead, quiet, fe], DOCS_CHAT);
    expect(unpushedParent(draft, fe, CHATS, 'full-auto')).toBe(
      "@api opens no pull request, so @fe cannot push until @api's branch is pushed.",
    );
    expect(unpushedParent(story().draft, fe, CHATS, 'full-auto')).toBeNull();
    expect(unpushedParent(draft, { ...fe, level: 'hands-off' }, CHATS, 'full-auto')).toBeNull();
  });

  it('drops the edge of a chat whose parent is removed', () => {
    const { draft, api, fe } = story();
    const left = withoutChat(draft, api.key);
    expect(left.chats.find((row) => row.key === fe.key)?.dependsOn).toBeNull();
  });

  it('says whose the first messages are and that dependents wait', () => {
    const { draft, lead, api } = story();
    expect(leadHandle(draft)).toBe('lead');
    expect(storyStartLines(draft)).toEqual([
      "First messages are sent as @lead's, not yours.",
      'A chat that starts after another waits until that one has answered.',
      "Each chat's own autonomy decides whether it opens a pull request.",
    ]);
    const joined = {
      ...storyDraft([api], DOCS_CHAT),
      into: {
        outpostId: OUTPOST_ID,
        name: 'Usage by user',
        members: [{ conversationId: DOCS_CHAT, handle: 'plan' }],
      },
    };
    expect(storyStartLines(joined)).toEqual([
      "First messages are sent as @plan's, not yours.",
      "Each chat's own autonomy decides whether it opens a pull request.",
    ]);
    expect(storyStartLines(draftOf([lead]))).toEqual([]);
  });
});
