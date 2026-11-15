import { describe, expect, it } from 'vitest';
import { connectorSummary, type ConnectorFacts } from './summary.ts';

const none: ConnectorFacts = {
  github: false,
  atlassianConnected: false,
  jira: false,
  confluence: false,
  linear: false,
  servicenowConnected: false,
  servicenow: false,
  slackConnected: false,
  slack: false,
  calendarConnected: false,
  calendarAgentsRead: true,
};

const stateOf = (facts: ConnectorFacts) =>
  Object.fromEntries(connectorSummary(facts).map((entry) => [entry.id, entry.state]));

describe('connectorSummary', () => {
  it('lists every connector, in a fixed order, as not connected when nothing is', () => {
    expect(connectorSummary(none).map((entry) => entry.id)).toEqual([
      'github',
      'jira',
      'confluence',
      'linear',
      'servicenow',
      'slack',
      'calendar',
    ]);
    expect(new Set(Object.values(stateOf(none)))).toEqual(new Set(['not_connected']));
  });

  it('marks what the agent gets as on', () => {
    const states = stateOf({ ...none, github: true, slack: true, linear: true });
    expect(states).toMatchObject({
      github: 'on',
      slack: 'on',
      linear: 'on',
      jira: 'not_connected',
    });
  });

  it('says a switch is off when Atlassian is connected but a product switch is not on', () => {
    const atlassian = { ...none, atlassianConnected: true };
    expect(stateOf({ ...atlassian, jira: true })).toMatchObject({
      jira: 'on',
      confluence: 'switch_off',
    });
    expect(stateOf(atlassian)).toMatchObject({ jira: 'switch_off', confluence: 'switch_off' });
    expect(stateOf({ ...atlassian, confluence: true })).toMatchObject({ confluence: 'on' });
  });

  it('keeps a saved ServiceNow or Slack connection out of Not connected when it is unusable', () => {
    expect(stateOf({ ...none, servicenowConnected: true })).toMatchObject({
      servicenow: 'switch_off',
    });
    expect(stateOf({ ...none, slackConnected: true })).toMatchObject({ slack: 'switch_off' });
  });

  it('says a switch is off when a calendar is connected but agents may not read it', () => {
    expect(stateOf({ ...none, calendarConnected: true, calendarAgentsRead: false })).toMatchObject({
      calendar: 'switch_off',
    });
    expect(stateOf({ ...none, calendarConnected: true })).toMatchObject({ calendar: 'on' });
  });
});
