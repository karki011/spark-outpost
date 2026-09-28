import '../../chat/project/agent-setup.css';
import './mcp.css';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { McpScanSource, SaveUserMcpRequest, UserMcpServer } from '@spark-outpost/contracts';
import { mcpApi } from '../../api/mcp.ts';
import { projectKeys, projectsApi } from '../../api/projects.ts';
import { McpServerCard } from './McpServerCard.tsx';
import { McpServerForm } from './McpServerForm.tsx';
import { useMcpChange, useUserMcp } from './use-mcp.ts';

type Editing = { server: UserMcpServer | null } | null;

function ScanSummary({ sources }: { sources: readonly McpScanSource[] }) {
  const found = sources.filter((source) => source.found);
  return (
    <div className="mcp-scan" role="status">
      <p>
        {found.length === 0
          ? 'No MCP settings found in Claude Code, Claude Desktop, Cursor, VS Code, Codex or Windsurf.'
          : 'Checked these files. Nothing was run; imported servers start off.'}
      </p>
      {found.length > 0 && (
        <ul>
          {found.map((source) => (
            <li key={source.path}>
              <b>{source.label}</b> · {source.servers} {source.servers === 1 ? 'server' : 'servers'}
              <small>{source.path}</small>
              {source.warnings.map((warning) => (
                <small key={warning} className="mcp-bad">
                  {warning}
                </small>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function McpSection() {
  const list = useUserMcp();
  const projects = useQuery({ queryKey: projectKeys.all, queryFn: projectsApi.list });
  const [editing, setEditing] = useState<Editing>(null);
  const scan = useMcpChange(() => mcpApi.scan());
  const save = useMcpChange((body: SaveUserMcpRequest) =>
    editing?.server ? mcpApi.edit(editing.server.id, body) : mcpApi.add(body),
  );
  const servers = list.data?.servers ?? [];

  return (
    <div className="mcp-section">
      <p className="lede">
        Your own MCP servers, for any chat. They start off: turn one on for all chats, only in some
        projects, or for one chat with /mcp. Every tool call still asks first, except at Full auto.
        Repo servers from .mcp.json are in each project’s Agent setup.
      </p>
      <div className="mcp-actions">
        <button
          type="button"
          className="btn line sm"
          disabled={scan.isPending}
          onClick={() => scan.mutate()}
        >
          {scan.isPending ? 'Scanning…' : 'Scan other apps'}
        </button>
        <button
          type="button"
          className="btn primary sm"
          onClick={() => {
            save.reset();
            setEditing({ server: null });
          }}
        >
          Add server
        </button>
      </div>
      {scan.isError && (
        <p className="mcp-error" role="alert">
          {scan.error.message}
        </p>
      )}
      {list.data?.scan && <ScanSummary sources={list.data.scan} />}
      {editing && (
        <McpServerForm
          key={editing.server?.id ?? 'new'}
          server={editing.server}
          busy={save.isPending}
          error={save.isError ? save.error.message : null}
          onCancel={() => setEditing(null)}
          onSave={(body) => save.mutate(body, { onSuccess: () => setEditing(null) })}
        />
      )}
      {list.isError && (
        <p className="mcp-error" role="alert">
          {list.error.message}
        </p>
      )}
      {list.data && servers.length === 0 && !editing && (
        <p className="mcp-empty">No MCP servers yet. Scan your other apps or add one.</p>
      )}
      <div className="mcp-list">
        {servers.map((server) => (
          <McpServerCard
            key={server.id}
            server={server}
            projects={projects.data ?? []}
            onEdit={(chosen) => {
              save.reset();
              setEditing({ server: chosen });
            }}
          />
        ))}
      </div>
    </div>
  );
}
