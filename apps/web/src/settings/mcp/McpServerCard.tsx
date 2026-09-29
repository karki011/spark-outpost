import { useId } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { McpEnableRequest, Project, UserMcpServer } from '@spark-outpost/contracts';
import { mcpApi } from '../../api/mcp.ts';
import { SetupSwitch } from '../../chat/project/SetupCard.tsx';
import { ChevronIcon } from '../../ui/icons.tsx';
import { fadeReveal } from '../../ui/transitions.tsx';
import { checkLine, scopeLine, sourceLabel, statusOf } from './mcp-labels.ts';
import { McpProjectOverrides } from './McpProjectOverrides.tsx';
import { McpServerDetails } from './McpServerDetails.tsx';
import { useMcpChange } from './use-mcp.ts';

interface McpServerCardProps {
  server: UserMcpServer;
  projects: readonly Project[];
  open: boolean;
  onToggle: () => void;
  onEdit: (server: UserMcpServer) => void;
  onRemove: (server: UserMcpServer) => void;
}

export function McpServerCard({
  server,
  projects,
  open,
  onToggle,
  onEdit,
  onRemove,
}: McpServerCardProps) {
  const nameId = useId();
  const bodyId = useId();
  const enable = useMcpChange((body: McpEnableRequest) => mcpApi.enable(server.id, body));
  const test = useMcpChange(() => mcpApi.test(server.id));
  const failure = [enable, test].find((mutation) => mutation.isError)?.error;
  const globalOn = server.global?.enabled ?? false;
  const status = test.isPending ? { tone: 'none', text: 'Testing…' } : statusOf(server);

  return (
    <section className={open ? 'mcp-card open' : 'mcp-card'} aria-labelledby={nameId}>
      <div className="mcp-row">
        <h4>
          <button
            type="button"
            className="mcp-head"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={onToggle}
          >
            <code id={nameId} className="mcp-name">
              {server.name}
            </code>
            <span className="mcp-chip">{sourceLabel(server.source)}</span>
            <span className="mcp-chip">{server.transport.toUpperCase()}</span>
            <span className={`mcp-status ${status.tone}`}>{status.text}</span>
            <span className="mcp-scope">{scopeLine(server)}</span>
            <span className="mcp-switch-slot" aria-hidden="true" />
            <ChevronIcon />
          </button>
        </h4>
        <span className="mcp-global">
          <SetupSwitch
            label={`Use ${server.name} in all chats`}
            checked={globalOn}
            disabled={enable.isPending}
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
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="body" id={bodyId} className="mcp-collapse" {...fadeReveal}>
            <div className="mcp-body">
              {statusOf(server).tone === 'warn' && (
                <p className="mcp-warn" role="status">
                  The config changed since you turned it on, so it is off. Review it, then turn it
                  on again.
                </p>
              )}
              <McpServerDetails server={server} />
              <McpProjectOverrides
                server={server}
                projects={projects}
                busy={enable.isPending}
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
                <button
                  type="button"
                  className="btn ghost sm mcp-danger mcp-remove"
                  onClick={() => onRemove(server)}
                >
                  Remove
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {failure && (
        <p className="mcp-error mcp-card-error" role="alert">
          {failure.message}
        </p>
      )}
    </section>
  );
}
