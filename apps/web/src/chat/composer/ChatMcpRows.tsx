import type { ChatMcpServer } from '@spark-outpost/contracts';
import { SetupSwitch } from '../project/SetupCard.tsx';
import { projectServerDetail, userServerDetail, type ChatMcpUserServer } from './use-chat-mcp.ts';

interface ChatMcpRowsProps {
  servers: readonly ChatMcpServer[];
  busy: boolean;
  onSet(server: ChatMcpUserServer, enabled: boolean | null): void;
}

export function ChatMcpRows({ servers, busy, onSet }: ChatMcpRowsProps) {
  return (
    <ul aria-label="MCP servers">
      {servers.map((server) =>
        server.kind === 'user' ? (
          <li key={server.id}>
            <span className="mcppop-text">
              <code>{server.name}</code>
              <small title={userServerDetail(server)}>{userServerDetail(server)}</small>
            </span>
            {server.via === 'chat' && (
              <button
                type="button"
                className="btn ghost sm"
                disabled={busy}
                onClick={() => onSet(server, null)}
              >
                Reset
              </button>
            )}
            <SetupSwitch
              label={`Use ${server.name} in this chat`}
              checked={server.enabled}
              disabled={busy}
              onChange={(checked) => onSet(server, checked)}
            />
          </li>
        ) : (
          <li key={`${server.projectId}:${server.name}`}>
            <span className="mcppop-text">
              <code>{server.name}</code>
              <small title={projectServerDetail(server)}>{projectServerDetail(server)}</small>
            </span>
          </li>
        ),
      )}
    </ul>
  );
}
