ALTER TABLE ticket_connections
  ADD COLUMN jira_on boolean NOT NULL DEFAULT true,
  ADD COLUMN jira_reach text CHECK (jira_reach IN ('reachable', 'denied')),
  ADD COLUMN confluence_on boolean NOT NULL DEFAULT false,
  ADD COLUMN confluence_reach text CHECK (confluence_reach IN ('reachable', 'denied'));

UPDATE ticket_connections SET jira_reach = 'reachable' WHERE source = 'jira';
