import { describe, expect, it } from 'vitest';
import {
  TITLE_MAX_LENGTH,
  UNTITLED_CONVERSATION,
  clipAtWord,
  sendMessageRequestSchema,
  shownChatTitle,
  titleFromMessage,
} from './conversations.ts';
import { queueAddRequestSchema, queueEditRequestSchema } from './chat-queue.ts';
import { memberMessageRequestSchema } from './crew-messages.ts';

const LONG = 'x'.repeat(100_000);
const ID = '00000000-0000-4000-8000-000000000001';

describe('message text a user sends', () => {
  it('has no length limit in a new message', () => {
    expect(sendMessageRequestSchema.parse({ id: ID, content: LONG }).content).toHaveLength(100_000);
  });

  it('has no length limit in the queue', () => {
    expect(queueAddRequestSchema.parse({ id: ID, content: LONG }).content).toHaveLength(100_000);
    expect(queueEditRequestSchema.parse({ content: LONG }).content).toHaveLength(100_000);
  });

  it('has no length limit when it goes to a running turn', () => {
    expect(memberMessageRequestSchema.parse({ id: ID, text: LONG }).text).toHaveLength(100_000);
  });

  it('still needs some text or a file', () => {
    expect(sendMessageRequestSchema.safeParse({ id: ID, content: '   ' }).success).toBe(false);
    expect(queueAddRequestSchema.safeParse({ id: ID, content: '' }).success).toBe(false);
  });
});

describe('titleFromMessage', () => {
  it('uses the first line, trimmed to the title limit', () => {
    expect(titleFromMessage('  Fix login\nwith details')).toBe('Fix login');
    expect(titleFromMessage('x'.repeat(60))).toHaveLength(TITLE_MAX_LENGTH);
  });

  it('skips leading blank lines and falls back for blank content', () => {
    expect(titleFromMessage('\n\nlater')).toBe('later');
    expect(titleFromMessage('   ')).toBe(UNTITLED_CONVERSATION);
  });
});

describe('clipAtWord', () => {
  it('keeps short text and cuts long text at a word boundary with an ellipsis', () => {
    expect(clipAtWord('  Fix login  ', 20)).toBe('Fix login');
    expect(clipAtWord('Move the date formatting in src/format.ts and the report line', 50)).toBe(
      'Move the date formatting in src/format.ts and the…',
    );
    expect(clipAtWord('abcdefghij', 5)).toBe('abcd…');
  });

  it('clips titles from a long first line without cutting a word', () => {
    const title = titleFromMessage(`${'word '.repeat(30)}end`);
    expect(title.endsWith('word…')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(TITLE_MAX_LENGTH);
  });
});

describe('shownChatTitle', () => {
  it('keeps a title and names a blank one', () => {
    expect(shownChatTitle('Fix login')).toBe('Fix login');
    expect(shownChatTitle(' \n ')).toBe(UNTITLED_CONVERSATION);
  });
});
