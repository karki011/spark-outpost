import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { linkChatTicketRequestSchema } from './chat-tickets.ts';
import {
  isTicketKey,
  ticketKeyHint,
  ticketKeySchema,
  ticketKeySchemaFor,
  ticketKeysInText,
} from './ticket-keys.ts';

describe('ticket key shapes', () => {
  it('keeps Jira and Linear on the dashed key', () => {
    for (const source of ['jira', 'linear'] as const) {
      expect(isTicketKey('ENG-12', source)).toBe(true);
      expect(isTicketKey('eng-12', source)).toBe(true);
      expect(isTicketKey('INC0010023', source)).toBe(false);
      expect(isTicketKey('ENG12', source)).toBe(false);
      expect(ticketKeyHint(source)).toBe('Use a ticket key such as ENG-12.');
    }
  });

  it('gives ServiceNow the record number and keeps the Jira schema dashed', () => {
    for (const key of ['INC0010023', 'SCTASK0010051', 'ritm0010045']) {
      expect(isTicketKey(key, 'servicenow')).toBe(true);
    }
    for (const key of ['INC12', 'X0010023', 'INC-0010023']) {
      expect(isTicketKey(key, 'servicenow')).toBe(false);
    }
    expect(isTicketKey('INC0010023', 'servicenow')).toBe(true);
    expect(isTicketKey('ENG-12', 'servicenow')).toBe(false);
    expect(ticketKeyHint('servicenow')).toBe('Use a ticket key such as INC0010023.');
    expect(ticketKeySchema.safeParse(' ENG-12 ').data).toBe('ENG-12');
    expect(ticketKeySchema.safeParse('RITM0010045').data).toBe('RITM0010045');
    expect(ticketKeySchema.safeParse('ENG 12').error?.issues[0]?.message).toBe(
      'Use a ticket key such as ENG-12 or INC0010023.',
    );
    expect(z.toJSONSchema(ticketKeySchemaFor('jira'))).toMatchObject({
      pattern: '^[A-Za-z][A-Za-z0-9_]*-\\d+$',
      maxLength: 64,
    });
  });

  it('finds keys in text the way mentions did', () => {
    const found = (text: string) => [...text.matchAll(ticketKeysInText())].map((m) => m[1]);
    expect(found('Fix ENG-12 and API-81, not a-1, UTF-8 or ENG-0')).toEqual([
      'ENG-12',
      'API-81',
      'UTF-8',
    ]);
    expect(found('see path/ENG-12 and ENG-12-x')).toEqual([]);
    expect(found('Look at INC0010023 and RITM0010045, not path/INC0010023')).toEqual([
      'INC0010023',
      'RITM0010045',
    ]);
  });

  it('checks a linked key against its own source', () => {
    expect(linkChatTicketRequestSchema.safeParse({ source: 'jira', key: 'ENG-12' }).success).toBe(
      true,
    );
    expect(
      linkChatTicketRequestSchema.safeParse({ source: 'servicenow', key: 'INC0010023' }).success,
    ).toBe(true);
    const wrong = linkChatTicketRequestSchema.safeParse({ source: 'linear', key: 'INC0010023' });
    expect(wrong.error?.issues.map((issue) => issue.message)).toContain(
      'Use a ticket key such as ENG-12.',
    );
  });
});
