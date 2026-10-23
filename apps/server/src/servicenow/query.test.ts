import { describe, expect, it } from 'vitest';
import { inboxQuery, numberQuery, plainQueryText, safeSysId, searchQuery } from './query.ts';

const ME = '6816f79cc0a8016401c5a33be04be441';
const GROUP = '287ebd7da9fe198100f92cc8d1d2154e';

describe('ServiceNow encoded queries', () => {
  it('asks for my open records, newest first', () => {
    expect(inboxQuery({ me: ME, groups: [GROUP], scope: 'me' })).toBe(
      `active=true^assigned_to=${ME}^ORDERBYDESCsys_updated_on`,
    );
  });

  it('adds records waiting in my groups as a second query', () => {
    expect(inboxQuery({ me: ME, groups: [GROUP, 'g2'], scope: 'groups' })).toBe(
      `active=true^assigned_to=${ME}^NQactive=true^assignment_groupIN${GROUP},g2^assigned_toISEMPTY^ORDERBYDESCsys_updated_on`,
    );
    expect(inboxQuery({ me: ME, groups: [], scope: 'groups', status: 'done' })).toBe(
      `active=false^assigned_to=${ME}^ORDERBYDESCsys_updated_on`,
    );
  });

  it('keeps search words from changing the query', () => {
    const query = searchQuery({
      text: 'vpn^NQactive=false^ORpriority=1\nnext',
      me: ME,
      assignee: 'anyone',
    });
    expect(query).toBe(
      'active=true^short_descriptionLIKEvpn NQactive=false ORpriority=1 next^ORdescriptionLIKEvpn NQactive=false ORpriority=1 next^ORDERBYDESCsys_updated_on',
    );
    expect(query.split('^NQ')).toHaveLength(1);
    expect(plainQueryText(' a^b \t c ')).toBe('a b c');
  });

  it('searches a record number exactly and filters by assignee', () => {
    expect(searchQuery({ text: 'inc0010023', me: ME, assignee: 'others' })).toBe(
      `active=true^assigned_toISNOTEMPTY^assigned_to!=${ME}^number=INC0010023^ORDERBYDESCsys_updated_on`,
    );
    expect(searchQuery({ text: '', me: ME, assignee: 'unassigned', status: 'done' })).toBe(
      'active=false^assigned_toISEMPTY^ORDERBYDESCsys_updated_on',
    );
  });

  it('refuses ids and numbers that could carry query syntax', () => {
    expect(() => safeSysId('abc^ORactive=true')).toThrow();
    expect(() => inboxQuery({ me: ME, groups: ['g^NQ'], scope: 'groups' })).toThrow();
    expect(numberQuery(' ritm0010045 ')).toBe('number=RITM0010045');
    expect(() => numberQuery('INC001^NQ')).toThrow();
  });
});
