import { useId } from 'react';
import type { ChatMcpServer } from '@spark-outpost/contracts';
import { SetupSwitch } from '../project/SetupCard.tsx';
import { ToolText } from '../tools/ToolsGroupFrame.tsx';
import {
  projectServerDetail,
  userServerDetail,
  type ChatMcpProjectServer,
  type ChatMcpUserServer,
} from './use-chat-mcp.ts';

interface ChatMcpRowsProps {
  servers: readonly ChatMcpServer[];
  busy: boolean;
  onSet(server: ChatMcpUserServer, enabled: boolean | null): void;
}

interface UserRowProps {
  server: ChatMcpUserServer;
  busy: boolean;
  onSet: ChatMcpRowsProps['onSet'];
}

function UserServerRow({ server, busy, onSet }: UserRowProps) {
  const noteId = useId();
  const status = server.changed || server.check?.ok === false;
  return (
    <li>
      <ToolText
        name={server.name}
        note={userServerDetail(server)}
        noteId={noteId}
        status={status}
      />
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
        describedBy={noteId}
        onChange={(checked) => onSet(server, checked)}
      />
    </li>
  );
}

function ProjectServerRow({ server }: { server: ChatMcpProjectServer }) {
  return (
    <li>
      <ToolText name={server.name} note={projectServerDetail(server)} status />
    </li>
  );
}

export function ChatMcpRows({ servers, busy, onSet }: ChatMcpRowsProps) {
  return (
    <ul aria-label="MCP servers">
      {servers.map((server) =>
        server.kind === 'user' ? (
          <UserServerRow key={server.id} server={server} busy={busy} onSet={onSet} />
        ) : (
          <ProjectServerRow key={`${server.projectId}:${server.name}`} server={server} />
        ),
      )}
    </ul>
  );
}
