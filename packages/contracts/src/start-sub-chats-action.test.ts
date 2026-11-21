import { describe, expect, it } from 'vitest';
import {
  applySparkEdits,
  editableFields,
  sparkActionQuestion,
  sparkActionSchema,
} from './spark-actions.ts';
import {
  startSubChatsActionSchema,
  subChatActionAuditFacts,
  subChatPlacement,
  subChatsStartedActivitySchema,
  type PlannedSubChat,
  type StartSubChatsAction,
} from './start-sub-chats-action.ts';

const PARENT = { id: '10000000-0000-4000-8000-000000000000', title: 'Checkout rework' };
const API = '20000000-0000-4000-8000-000000000001';
const WEB = '20000000-0000-4000-8000-000000000002';
const DOCS = '20000000-0000-4000-8000-000000000003';
const PROJECT = { id: '30000000-0000-4000-8000-000000000000', name: 'shop' };

function piece(conversationId: string, title: string, plan: Partial<PlannedSubChat> = {}) {
  return {
    conversationId,
    title,
    task: `Build ${title}.`,
    project: PROJECT,
    provider: 'claude',
    agentName: 'Claude',
    model: 'sonnet',
    effort: 'medium',
    agentMode: 'auto',
    level: 'full-auto',
    sameAsParent: true,
    stackedOn: null,
    startsAfter: [],
    ...plan,
  } satisfies PlannedSubChat;
}

const action: StartSubChatsAction = {
  action: 'start_sub_chats',
  parent: PARENT,
  pieces: [
    piece(API, 'Orders API'),
    piece(WEB, 'Orders page', { stackedOn: API }),
    piece(DOCS, 'Docs', { startsAfter: [API, WEB] }),
  ],
};

describe('the start_sub_chats action', () => {
  it('is a Spark action that needs at least one piece and has no upper limit', () => {
    expect(sparkActionSchema.parse(action)).toEqual(action);
    const many = Array.from({ length: 40 }, (_, index) =>
      piece(`40000000-0000-4000-8000-0000000000${String(index).padStart(2, '0')}`, `P${index}`),
    );
    expect(startSubChatsActionSchema.safeParse({ ...action, pieces: many }).success).toBe(true);
    expect(startSubChatsActionSchema.safeParse({ ...action, pieces: [] }).success).toBe(false);
  });

  it('asks with the number of sub-chats', () => {
    expect(sparkActionQuestion(action)).toBe('Start 3 sub-chats?');
    expect(sparkActionQuestion({ ...action, pieces: [piece(API, 'Orders API')] })).toBe(
      'Start 1 sub-chat?',
    );
  });

  it('says where each piece starts by piece number', () => {
    const [api, web, docs] = action.pieces;
    expect(subChatPlacement(api!, action.pieces)).toBe('New branch');
    expect(subChatPlacement(web!, action.pieces)).toBe('Stacked on 1');
    expect(subChatPlacement(docs!, action.pieces)).toBe('Starts after 1, 2');
  });

  it('lets the card change model and effort per piece and nothing else', () => {
    expect(editableFields('start_sub_chats')).toEqual(['subChats']);
    const edited = applySparkEdits(action, {
      title: 'Ignored',
      subChats: [
        { id: WEB, model: 'opus', effort: 'high' },
        { id: DOCS, effort: null },
      ],
    });
    if (edited.action !== 'start_sub_chats') throw new Error('The action changed kind.');
    expect(edited.pieces[0]).toEqual(action.pieces[0]);
    expect(edited.pieces[1]).toMatchObject({
      title: 'Orders page',
      model: 'opus',
      effort: 'high',
      sameAsParent: false,
      agentMode: 'auto',
    });
    expect(edited.pieces[2]).toMatchObject({ model: 'sonnet', effort: null });
    expect(applySparkEdits(action, null)).toEqual(action);
  });

  it('is audited without the task text', () => {
    expect(JSON.stringify(subChatActionAuditFacts(action))).not.toContain('Build Orders');
    expect(subChatActionAuditFacts(action)).toMatchObject({
      parent: PARENT,
      pieces: [{ title: 'Orders API', model: 'sonnet' }, { stackedOn: API }, {}],
    });
  });
});

describe('the stop_sub_chat action', () => {
  it('names the sub-chat in its question and has nothing to edit', () => {
    const stop = {
      action: 'stop_sub_chat',
      parent: PARENT,
      subChat: { id: API, title: 'Orders API' },
    };
    expect(sparkActionQuestion(sparkActionSchema.parse(stop))).toBe('Stop “Orders API”?');
    expect(editableFields('stop_sub_chat')).toEqual([]);
  });
});

describe('the started line of a parent turn', () => {
  it('lists the sub-chats, which are held, and what did not start', () => {
    const line = {
      subChats: [
        { id: API, title: 'Orders API', held: false },
        { id: WEB, title: 'Orders page', held: true },
      ],
      notStarted: [{ title: 'Docs', reason: 'That project no longer exists.' }],
    };
    expect(subChatsStartedActivitySchema.parse(line)).toEqual(line);
  });
});
