ALTER TABLE mcp_servers ADD COLUMN last_check jsonb;

CREATE INDEX mcp_server_enablements_scope_idx ON mcp_server_enablements (scope, scope_key);
