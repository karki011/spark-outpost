import { useId, useState } from 'react';
import type { McpEnableRequest, Project, UserMcpServer } from '@spark-outpost/contracts';
import { mcpApi } from '../../api/mcp.ts';
import { SetupSwitch } from '../../chat/project/SetupCard.tsx';
import { checkLine, sourceLabel, targetLine } from './mcp-labels.ts';
import { McpProjectOverrides } from './McpProjectOverrides.tsx';
import { useMcpChange } from './use-mcp.ts';

interface McpServerCardProps {
  server: UserMcpServer;
  projects: readonly Project[];
  onEdit: (server: UserMcpServer) => void;
}

function fileName(path: string): string {
  return path.split('/').at(-1) ?? path;
}

export function McpServerCard({ server, projects, onEdit }: McpServerCardProps) {
  const headingId = useId();
  const [confirming, setConfirming] = useState(false);
  const enable = useMcpChange((body: McpEnableRequest) => mcpApi.enable(server.id, body));
  const test = useMcpChange(() => mcpApi.test(server.id));
  const remove = useMcpChange(() => mcpApi.remove(server.id));
  const copy = useMcpChange(() =>
    mcpApi.copySecrets(server.id, {
      fingerprint: server.fingerprint,
      names: server.importableNames,
    }),
  );
  const failure = [enable, test, remove, copy].find((mutation) => mutation.isError)?.error;
  const busy = enable.isPending || remove.isPending;
  const globalOn = server.global?.enabled ?? false;
  const changed = server.global?.changed || server.projects.some((row) => row.changed);
  const names = server.transport === 'stdio' ? server.envNames : server.headerNames;

  return (
    <section className="mcp-card" aria-labelledby={headingId}>
      <div className="mcp-card-head">
        <h4 id={headingId}>
          <code>{server.name}</code>
        </h4>
        <span className="mcp-chip">{sourceLabel(server.source)}</span>
        <span className="mcp-chip">{server.transport.toUpperCase()}</span>
        <span className="mcp-global">
          <small>All chats</small>
          <SetupSwitch
            label={`Use ${server.name} in all chats`}
            checked={globalOn}
            disabled={busy}
            onChange={(checked) =>
              enable.mutate(
                checked
                  ? { scope: 'global', enabled: true, fingerprint: server.fingerprint }
                  : { scope: 'global', enabled: false },
              )
            }
          />
        </span>
      </div>
      <p className="mcp-target">
        <code>{targetLine(server)}</code>
      </p>
      {names.length > 0 && (
        <p className="mcp-meta">
          {server.transport === 'stdio' ? 'Env' : 'Headers'}: {names.join(', ')}
          {server.secretNames.length > 0 && <> · in keychain: {server.secretNames.join(', ')}</>}
        </p>
      )}
      {changed && (
        <p className="mcp-warn" role="status">
          The config changed since you turned it on, so it is off. Review it, then turn it on again.
        </p>
      )}
      {server.importableNames.length > 0 && server.origin && (
        <div className="mcp-import">
          <p>
            {fileName(server.origin)} has values for {server.importableNames.join(', ')}. Copy them
            to your keychain so this server gets them?
          </p>
          <button
            type="button"
            className="btn line sm"
            disabled={copy.isPending}
            onClick={() => copy.mutate()}
          >
            Copy {server.importableNames.length === 1 ? 'value' : 'values'} to keychain
          </button>
        </div>
      )}
      <McpProjectOverrides
        server={server}
        projects={projects}
        busy={busy}
        onChange={enable.mutate}
      />
      <div className="mcp-check" aria-live="polite">
        <span className={server.check?.ok === false ? 'mcp-bad' : undefined}>
          {test.isPending ? 'Testing…' : checkLine(server.check, server.fingerprint)}
        </span>
        {server.check?.ok && server.check.tools.length > 0 && (
          <small>{server.check.tools.join(', ')}</small>
        )}
        {server.check?.error && <pre className="mcp-error-text">{server.check.error}</pre>}
      </div>
      {failure && (
        <p className="mcp-error" role="alert">
          {failure.message}
        </p>
      )}
      <div className="mcp-actions">
        <button
          type="button"
          className="btn line sm"
          disabled={test.isPending}
          title="Starts the server with a time limit and lists its tools"
          onClick={() => test.mutate()}
        >
          Test connection
        </button>
        {server.source === 'user' && (
          <button type="button" className="btn ghost sm" onClick={() => onEdit(server)}>
            Edit
          </button>
        )}
        {confirming ? (
          <>
            <button
              type="button"
              className="btn ghost sm mcp-danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Remove {server.name}
            </button>
            <button type="button" className="btn ghost sm" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <button type="button" className="btn ghost sm" onClick={() => setConfirming(true)}>
            Remove
          </button>
        )}
      </div>
    </section>
  );
}
