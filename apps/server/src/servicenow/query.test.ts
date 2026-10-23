import { describe, expect, it } from 'vitest';
import {
  AgentQueryError,
  agentQuery,
  inboxQuery,
  numberQuery,
  plainQueryText,
  safeSysId,
  searchQuery,
} from './query.ts';

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

  it('runs an agent query as given, or scoped to me and my groups', () => {
    expect(agentQuery({ query: 'priority=1', mine: null })).toBe(
      'priority=1^ORDERBYDESCsys_updated_on',
    );
    expect(agentQuery({ query: 'ORDERBYnumber', mine: null })).toBe('ORDERBYnumber');
    expect(agentQuery({ query: 'active=true', mine: { me: ME, groups: [GROUP] } })).toBe(
      `assigned_to=${ME}^active=true^NQassignment_groupIN${GROUP}^assigned_toISEMPTY^active=true^ORDERBYDESCsys_updated_on`,
    );
    expect(agentQuery({ query: '', mine: { me: ME, groups: [] } })).toBe(
      `assigned_to=${ME}^ORDERBYDESCsys_updated_on`,
    );
  });

  it('refuses javascript, line breaks and ^NQ with mine', () => {
    expect(() => agentQuery({ query: 'sys_id=javascript:gs.getUserID()', mine: null })).toThrow(
      AgentQueryError,
    );
    expect(() => agentQuery({ query: 'a=1^JavaScript :x', mine: null })).toThrow(AgentQueryError);
    expect(() => agentQuery({ query: 'a=1\nb=2', mine: null })).toThrow(AgentQueryError);
    expect(() => agentQuery({ query: 'a=1^NQb=2', mine: { me: ME, groups: [] } })).toThrow(
      AgentQueryError,
    );
    expect(() => agentQuery({ query: '', mine: { me: ME, groups: ['g^NQ'] } })).toThrow();
    expect(() =>
      agentQuery({ query: 'priority=1^ORactive=true', mine: { me: ME, groups: [] } }),
    ).toThrow(AgentQueryError);
    expect(agentQuery({ query: 'priority=1^ORDERBYnumber', mine: { me: ME, groups: [] } })).toBe(
      `assigned_to=${ME}^priority=1^ORDERBYnumber`,
    );
  });
});
