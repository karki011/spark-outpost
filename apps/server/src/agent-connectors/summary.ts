import type { AgentConnector, AgentConnectorState } from '@spark-outpost/contracts';

export interface ConnectorFacts {
  github: boolean;
  jira: boolean;
  confluence: boolean;
  linear: boolean;
  servicenow: boolean;
  slack: boolean;
  calendarConnected: boolean;
  calendarAgentsRead: boolean;
}

function state(on: boolean, connected = on): AgentConnectorState {
  if (on) return 'on';
  return connected ? 'switch_off' : 'not_connected';
}

export function connectorSummary(facts: ConnectorFacts): AgentConnector[] {
  return [
    { id: 'github', state: state(facts.github) },
    { id: 'jira', state: state(facts.jira) },
    { id: 'confluence', state: state(facts.confluence, facts.jira || facts.confluence) },
    { id: 'linear', state: state(facts.linear) },
    { id: 'servicenow', state: state(facts.servicenow) },
    { id: 'slack', state: state(facts.slack) },
    {
      id: 'calendar',
      state: state(facts.calendarConnected && facts.calendarAgentsRead, facts.calendarConnected),
    },
  ];
}
