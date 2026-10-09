import { describe, expect, it } from 'vitest';
import { API_CHAT, FE_CHAT, WEB_PROJECT, chat } from '../test-fixtures.ts';
import {
  emptyChat,
  hasUnsavedInput,
  listedChats,
  memberId,
  patchChat,
  settled,
  withChat,
  withExistingChat,
  withFiles,
  withHandle,
  withKind,
  withoutChat,
  withProject,
} from './create-draft.ts';
import { CODEX, countingIds, draftOf, existing, file } from './create-fixtures.ts';

const NAMES = { [WEB_PROJECT]: 'web' };

function opened() {
  const ids = countingIds();
  const first = emptyChat(CODEX, ids);
  return { ids, first, draft: draftOf([first], '') };
}

describe('a chat in the new outpost', () => {
  it('starts as an open, untouched existing-chat form with the default agent', () => {
    const { first, draft } = opened();
    expect(first).toMatchObject({ kind: 'existing', open: true, touched: false, ...CODEX });
    expect(new Set([first.key, first.newChatId, first.messageId]).size).toBe(3);
    expect(listedChats(draft)).toEqual([]);
  });

  it('stays untouched when only the kind is switched', () => {
    const { first, draft } = opened();
    const switched = withKind(draft, first.key, 'new');
    expect(switched.chats[0]).toMatchObject({ kind: 'new', touched: false });
    expect(memberId(switched.chats[0]!)).toBe(first.newChatId);
  });

  it('takes a picked chat, suggests its handle from the project, and becomes a row', () => {
    const { first, draft } = opened();
    const picked = chat(FE_CHAT, { title: 'Usage page', projectIds: [WEB_PROJECT] });
    const [row] = withExistingChat(draft, first.key, picked, NAMES).chats;
    expect(row).toMatchObject({
      chatId: FE_CHAT,
      handle: 'web',
      open: false,
      added: true,
      touched: true,
    });
    expect(memberId(row!)).toBe(FE_CHAT);
  });

  it('suggests a handle from the title when the chat has no project, avoiding taken ones', () => {
    const ids = countingIds();
    const second = emptyChat(CODEX, ids);
    const draft = draftOf([existing(ids, FE_CHAT, 'rate-limit'), second]);
    const picked = chat(API_CHAT, { title: 'Rate limit' });
    expect(withExistingChat(draft, second.key, picked, NAMES).chats[1]?.handle).toBe('rate-limit2');
  });

  it('suggests the handle of a new chat from its project until a handle is typed', () => {
    const { first, draft } = opened();
    const typed = withHandle(
      withProject(draft, first.key, { id: WEB_PROJECT, name: 'web' }),
      first.key,
      '@Front',
    );
    expect(withProject(draft, first.key, { id: WEB_PROJECT, name: 'web' }).chats[0]).toMatchObject({
      projectId: WEB_PROJECT,
      handle: 'web',
      touched: true,
    });
    expect(typed.chats[0]).toMatchObject({ handle: 'front', handleTyped: true });
    expect(withProject(typed, first.key, { id: WEB_PROJECT, name: 'other' }).chats[0]?.handle).toBe(
      'front',
    );
  });

  it('keeps files in step with the message box and changes nothing when they are the same', () => {
    const { first, draft } = opened();
    const withOne = withFiles(draft, first.key, [file(1)], true);
    expect(withOne.chats[0]).toMatchObject({ files: [file(1)], filesPending: true });
    expect(withFiles(withOne, first.key, [file(1)], true)).toBe(withOne);
    expect(withFiles(withOne, 'gone', [], false)).toBe(withOne);
  });

  it('is removed by key', () => {
    const { first, draft } = opened();
    expect(withoutChat(draft, first.key).chats).toEqual([]);
  });
});

describe('settling the chats', () => {
  it('drops untouched forms, closes finished ones and leaves unfinished ones open', () => {
    const ids = countingIds();
    const done = { ...existing(ids, FE_CHAT, 'fe'), open: true, added: false };
    const half = { ...existing(ids, API_CHAT, ''), open: true, added: false };
    const untouched = emptyChat(CODEX, ids);
    const result = settled(draftOf([done, half, untouched]), (chat) => chat.handle !== '');
    expect(result.chats.map((chat) => [chat.key, chat.open, chat.added])).toEqual([
      [done.key, false, true],
      [half.key, true, false],
    ]);
  });
});

describe('unsaved input', () => {
  it('is nothing for a sheet that was only opened or had its kind switched', () => {
    const { first, draft } = opened();
    expect(hasUnsavedInput(draft, draft)).toBe(false);
    expect(hasUnsavedInput(draft, withKind(draft, first.key, 'new'))).toBe(false);
    expect(hasUnsavedInput(draft, withChat(draft, emptyChat(CODEX)))).toBe(false);
  });

  it('is a typed name, a picked chat or a written message', () => {
    const { first, draft } = opened();
    expect(hasUnsavedInput(draft, { ...draft, name: 'Usage' })).toBe(true);
    expect(hasUnsavedInput(draft, patchChat(draft, first.key, { text: 'Add the filter' }))).toBe(
      true,
    );
    const started = withExistingChat(draft, first.key, chat(FE_CHAT), NAMES);
    expect(hasUnsavedInput(draft, started)).toBe(true);
    expect(hasUnsavedInput(started, started)).toBe(false);
  });
});
