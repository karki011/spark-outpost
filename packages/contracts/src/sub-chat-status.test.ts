import { describe, expect, it } from 'vitest';
import {
  SUB_CHAT_GROUP_ORDER,
  SUB_CHAT_STATUS_WORDS,
  subChatStatus,
  type SubChatFacts,
} from './sub-chat-status.ts';

const FINISHED: SubChatFacts = {
  started: true,
  archived: false,
  needsInput: false,
  runStatus: 'succeeded',
  taskQueued: false,
  pullRequest: null,
  keptChanges: false,
};

function statusOf(facts: Partial<SubChatFacts>) {
  return subChatStatus({ ...FINISHED, ...facts });
}

describe('sub-chat status', () => {
  it('is Held until the sub-chat starts', () => {
    expect(statusOf({ started: false, runStatus: null })).toBe('held');
  });

  it('is Needs you for a waiting card or question', () => {
    expect(statusOf({ needsInput: true, runStatus: 'running' })).toBe('needs_you');
    expect(statusOf({ runStatus: 'awaiting_approval' })).toBe('needs_you');
  });

  it('is Needs you when the last turn failed, was stopped or has an unknown outcome', () => {
    expect(statusOf({ runStatus: 'failed' })).toBe('needs_you');
    expect(statusOf({ runStatus: 'cancelled' })).toBe('needs_you');
    expect(statusOf({ runStatus: 'outcome_unknown' })).toBe('needs_you');
  });

  it('is Working while a turn runs or is queued, or its task is queued', () => {
    expect(statusOf({ runStatus: 'running' })).toBe('working');
    expect(statusOf({ runStatus: 'queued' })).toBe('working');
    expect(statusOf({ runStatus: null, taskQueued: true })).toBe('working');
    expect(statusOf({ taskQueued: true, pullRequest: 'open' })).toBe('working');
  });

  it('is Ready for review after a good turn with an open pull request or kept changes', () => {
    expect(statusOf({ pullRequest: 'open' })).toBe('ready_for_review');
    expect(statusOf({ keptChanges: true })).toBe('ready_for_review');
  });

  it('is Done when the pull request is merged or closed, or nothing is left to review', () => {
    expect(statusOf({ pullRequest: 'merged', keptChanges: true })).toBe('done');
    expect(statusOf({ pullRequest: 'closed', keptChanges: true })).toBe('done');
    expect(statusOf({})).toBe('done');
    expect(statusOf({ runStatus: null })).toBe('done');
  });

  it('is Done for an archived sub-chat that would otherwise wait for review', () => {
    expect(statusOf({ archived: true, pullRequest: 'open' })).toBe('done');
    expect(statusOf({ archived: true, keptChanges: true })).toBe('done');
  });

  it('takes the first match: Held, then Needs you, then Working', () => {
    expect(statusOf({ started: false, needsInput: true, runStatus: 'failed' })).toBe('held');
    expect(statusOf({ started: false, archived: true })).toBe('held');
    expect(statusOf({ runStatus: 'failed', taskQueued: true, pullRequest: 'open' })).toBe(
      'needs_you',
    );
    expect(statusOf({ archived: true, runStatus: 'failed' })).toBe('needs_you');
    expect(statusOf({ archived: true, runStatus: 'running' })).toBe('working');
  });

  it('groups the Sub-chats tab with what needs the user first and Done last', () => {
    expect(SUB_CHAT_GROUP_ORDER.map((status) => SUB_CHAT_STATUS_WORDS[status])).toEqual([
      'Needs you',
      'Ready for review',
      'Working',
      'Held',
      'Done',
    ]);
  });
});
