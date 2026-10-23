import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { linkChatTicketRequestSchema } from './chat-tickets.ts';
import {
  isTicketKey,
  keyShapePattern,
  ticketKeyHint,
  ticketKeySchema,
  ticketKeySchemaFor,
  ticketKeysInText,
} from './ticket-keys.ts';

describe('ticket key shapes', () => {
  it('tells a dashed key from a record number', () => {
    expect(keyShapePattern('dashed').test('ENG-12')).toBe(true);
    expect(keyShapePattern('dashed').test('INC0010023')).toBe(false);
    expect(keyShapePattern('record').test('INC0010023')).toBe(true);
    expect(keyShapePattern('record').test('SCTASK0010051')).toBe(true);
    expect(keyShapePattern('record').test('ENG-12')).toBe(false);
    expect(keyShapePattern('record').test('INC12')).toBe(false);
    expect(keyShapePattern('record').test('X0010023')).toBe(false);
  });

  it('keeps Jira and Linear on the dashed key', () => {
    for (const source of ['jira', 'linear'] as const) {
      expect(isTicketKey('ENG-12', source)).toBe(true);
      expect(isTicketKey('eng-12', source)).toBe(true);
      expect(isTicketKey('INC0010023', source)).toBe(false);
      expect(isTicketKey('ENG12', source)).toBe(false);
      expect(ticketKeyHint(source)).toBe('Use a ticket key such as ENG-12.');
    }
  });

  it('keeps the shared key schema and its JSON Schema as they were', () => {
    expect(ticketKeySchema.safeParse(' ENG-12 ').data).toBe('ENG-12');
    expect(ticketKeySchema.safeParse('ENG 12').error?.issues[0]?.message).toBe(
      'Use a ticket key such as ENG-12.',
    );
    expect(z.toJSONSchema(ticketKeySchema)).toMatchObject({
      pattern: '^[A-Za-z][A-Za-z0-9_]*-\\d+$',
      maxLength: 64,
    });
    expect(z.toJSONSchema(ticketKeySchemaFor('jira'))).toEqual(z.toJSONSchema(ticketKeySchema));
  });

  it('finds keys in text the way mentions did', () => {
    const found = (text: string) => [...text.matchAll(ticketKeysInText())].map((m) => m[1]);
    expect(found('Fix ENG-12 and API-81, not a-1, UTF-8 or ENG-0')).toEqual([
      'ENG-12',
      'API-81',
      'UTF-8',
    ]);
    expect(found('see path/ENG-12 and ENG-12-x')).toEqual([]);
    expect(found('INC0010023 is not a source key yet')).toEqual([]);
  });

  it('checks a linked key against its own source', () => {
    expect(linkChatTicketRequestSchema.safeParse({ source: 'jira', key: 'ENG-12' }).success).toBe(
      true,
    );
    const wrong = linkChatTicketRequestSchema.safeParse({ source: 'linear', key: 'INC0010023' });
    expect(wrong.error?.issues.map((issue) => issue.message)).toContain(
      'Use a ticket key such as ENG-12.',
    );
  });
});
