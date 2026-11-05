import { describe, expect, it } from 'vitest';
import { createOutpostRequestSchema } from '@spark-outpost/contracts';
import { API_CHAT, FE_CHAT, OUTPOST_ID } from '../test-fixtures.ts';
import { emptyChat } from './create-draft.ts';
import {
  API_PROJECT,
  CODEX,
  countingIds,
  draftOf,
  existing,
  file,
  fresh,
  STORY_DRAFT_ID,
  storyDraft,
  withTask,
} from './create-fixtures.ts';
import { startLines, summaryLine } from './create-labels.ts';
import {
  buildCreateRequest,
  firstMessageOf,
  messageExcerpt,
  startSummary,
} from './create-request.ts';

function threeChats() {
  const ids = countingIds();
  const fe = existing(ids, FE_CHAT, 'fe');
  const api = {
    ...fresh(ids, API_PROJECT, 'api'),
    model: 'gpt-5',
    text: ' Add an optional userId filter. ',
    files: [file(1), file(2)],
  };
  const docs = { ...existing(ids, API_CHAT, 'docs'), text: 'Document the filter.' };
  return {
    fe,
    api,
    docs,
    draft: draftOf([fe, api, docs, emptyChat(CODEX, ids)], ' Usage by user '),
  };
}

describe('the create request', () => {
  it('lists existing and new chats in order, with first messages and file ids', () => {
    const { api, docs, draft } = threeChats();
    const request = buildCreateRequest(OUTPOST_ID, draft);

    expect(request).toEqual({
      id: OUTPOST_ID,
      name: 'Usage by user',
      members: [
        { conversationId: FE_CHAT, handle: 'fe' },
        {
          new: {
            conversationId: api.newChatId,
            projectId: API_PROJECT,
            provider: 'codex',
            model: 'gpt-5',
            agentMode: 'agent',
          },
          handle: 'api',
          firstMessage: {
            id: api.messageId,
            text: 'Add an optional userId filter.',
            attachmentIds: [file(1).id, file(2).id],
          },
        },
        {
          conversationId: API_CHAT,
          handle: 'docs',
          firstMessage: { id: docs.messageId, text: 'Document the filter.', attachmentIds: [] },
        },
      ],
    });
    expect(createOutpostRequestSchema.parse(request)).toEqual(request);
  });

  it('is the same request every time it is built from the same draft', () => {
    const { draft } = threeChats();
    expect(buildCreateRequest(OUTPOST_ID, draft)).toEqual(buildCreateRequest(OUTPOST_ID, draft));
  });

  it('sends no first message for an empty box', () => {
    const ids = countingIds();
    const blank = { ...existing(ids, FE_CHAT, 'fe'), messageOpen: true, text: '   ' };
    expect(firstMessageOf(blank)).toBeNull();
    expect(buildCreateRequest(OUTPOST_ID, draftOf([blank])).members).toEqual([
      { conversationId: FE_CHAT, handle: 'fe' },
    ]);
  });

  it('shortens a long first message to one line for the review', () => {
    const ids = countingIds();
    const long = { ...existing(ids, FE_CHAT, 'fe'), text: `First line\n${'word '.repeat(60)}` };
    const excerpt = messageExcerpt(long)!;
    expect(excerpt.startsWith('First line word')).toBe(true);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(messageExcerpt(existing(ids, API_CHAT, 'api'))).toBeNull();
  });
});

describe('what starting does', () => {
  it('counts the chats, the new ones and the first requests', () => {
    const summary = startSummary(threeChats().draft);
    expect(summary).toEqual({ chats: 3, newChats: 1, firstRequests: 2 });
    expect(summaryLine(summary)).toBe('3 chats · 1 new · 2 first messages');
    expect(startLines(summary)).toEqual([
      'Creates 1 new chat',
      'Sends 2 first requests',
      'Each chat works under its own mode.',
    ]);
  });

  it('says only that modes are kept when nothing is created or sent', () => {
    const ids = countingIds();
    const summary = startSummary(draftOf([existing(ids, FE_CHAT, 'fe')]));
    expect(summaryLine(summary)).toBe('1 chat');
    expect(startLines(summary)).toEqual(['Each chat works under its own mode.']);
  });
});

describe('the create request of a draft', () => {
  it('carries the draft, each starts-after edge as a chat id and a level the user picked', () => {
    const ids = countingIds();
    const lead = existing(ids, FE_CHAT, 'lead');
    const api = withTask(fresh(ids, API_PROJECT, 'api'), 'Add the endpoint.');
    const fe = {
      ...withTask(fresh(ids, API_PROJECT, 'fe'), 'Call it.', api.key),
      level: 'hands-off' as const,
    };
    const request = buildCreateRequest(OUTPOST_ID, storyDraft([lead, api, fe], FE_CHAT));

    expect(createOutpostRequestSchema.safeParse(request).success).toBe(true);
    expect(request.draftId).toBe(STORY_DRAFT_ID);
    expect(request.members.map((member) => member.dependsOn)).toEqual([
      undefined,
      undefined,
      api.newChatId,
    ]);
    const [, first, second] = request.members;
    expect(first && 'new' in first && 'level' in first.new).toBe(false);
    expect(second && 'new' in second ? second.new.level : null).toBe('hands-off');
  });

  it('sends no edge and no draft from a sheet opened by hand', () => {
    const ids = countingIds();
    const api = withTask(fresh(ids, API_PROJECT, 'api'), 'Add the endpoint.');
    const fe = withTask(fresh(ids, API_PROJECT, 'fe'), 'Call it.', api.key);
    const request = buildCreateRequest(OUTPOST_ID, draftOf([api, fe]));
    expect('draftId' in request).toBe(false);
    expect(request.members.some((member) => 'dependsOn' in member)).toBe(false);
  });
});
