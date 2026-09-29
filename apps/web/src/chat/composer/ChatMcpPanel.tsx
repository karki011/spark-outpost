import '../../settings/mcp/mcp.css';
import '../project/agent-setup.css';
import { useEffect, useId, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatMcpServer, McpEnableRequest } from '@spark-outpost/contracts';
import { chatMcpKey, mcpApi, userMcpKey } from '../../api/mcp.ts';
import { requestSettings } from '../../settings/settings-request.ts';
import { checkLine, sourceLabel } from '../../settings/mcp/mcp-labels.ts';
import { SetupSwitch } from '../project/SetupCard.tsx';

interface ChatMcpPanelProps {
  conversationId: string;
  onClose: () => void;
}

type UserRow = Extract<ChatMcpServer, { kind: 'user' }>;
type ProjectRow = Extract<ChatMcpServer, { kind: 'project' }>;

const VIA_LABELS: Record<UserRow['via'], string> = {
  chat: 'set for this chat',
  project: 'from the project setting',
  global: 'from the all-chats setting',
  off: 'off by default',
};

function userDetail(server: UserRow): string {
  const parts = [sourceLabel(server.source), VIA_LABELS[server.via]];
  if (server.changed) parts.push('changed, review it in Settings');
  else parts.push(checkLine(server.check, server.fingerprint));
  return parts.join(' · ');
}

function projectState(server: ProjectRow): string {
  if (server.changed) return 'changed, review it in Agent setup';
  return server.enabled ? 'on' : 'off';
}

function projectDetail(server: ProjectRow): string {
  return `${server.projectName} repo · ${projectState(server)}`;
}

export function ChatMcpPanel({ conversationId, onClose }: ChatMcpPanelProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const servers = useQuery({
    queryKey: chatMcpKey(conversationId),
    queryFn: () => mcpApi.forChat(conversationId),
  });
  const toggle = useMutation({
    mutationFn: ({ id, body }: { id: string; body: McpEnableRequest }) => mcpApi.enable(id, body),
    onSuccess: (list) => {
      queryClient.setQueryData(userMcpKey, list);
      return queryClient.invalidateQueries({ queryKey: chatMcpKey(conversationId) });
    },
  });
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onCloseRef.current();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, []);

  const setForChat = (server: UserRow, enabled: boolean | null) =>
    toggle.mutate({
      id: server.id,
      body: enabled
        ? { scope: 'chat', scopeId: conversationId, enabled: true, fingerprint: server.fingerprint }
        : { scope: 'chat', scopeId: conversationId, enabled },
    });

  const list = servers.data?.servers ?? [];
  return (
    <div
      ref={panelRef}
      className="mpop left mcppop open"
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      <h2 id={titleId}>MCP servers in this chat</h2>
      <p>Changes apply to the next message. Every tool call asks first, except at Full auto.</p>
      {servers.isPending && <p className="as-empty">Loading…</p>}
      {servers.isError && (
        <p className="mcp-error" role="alert">
          {servers.error.message}
        </p>
      )}
      {servers.data && list.length === 0 && (
        <p className="as-empty">No MCP servers yet. Add or import them in Settings.</p>
      )}
      {list.length > 0 && (
        <ul>
          {list.map((server) =>
            server.kind === 'user' ? (
              <li key={server.id}>
                <span className="mcppop-text">
                  <code>{server.name}</code>
                  <small>{userDetail(server)}</small>
                </span>
                {server.via === 'chat' && (
                  <button
                    type="button"
                    className="btn ghost sm"
                    disabled={toggle.isPending}
                    onClick={() => setForChat(server, null)}
                  >
                    Reset
                  </button>
                )}
                <SetupSwitch
                  label={`Use ${server.name} in this chat`}
                  checked={server.enabled}
                  disabled={toggle.isPending}
                  onChange={(checked) => setForChat(server, checked)}
                />
              </li>
            ) : (
              <li key={`${server.projectId}:${server.name}`}>
                <span className="mcppop-text">
                  <code>{server.name}</code>
                  <small>{projectDetail(server)}</small>
                </span>
              </li>
            ),
          )}
        </ul>
      )}
      {toggle.isError && (
        <p className="mcp-error" role="alert">
          {toggle.error.message}
        </p>
      )}
      <div className="mcppop-foot">
        <button
          type="button"
          className="btn line sm"
          onClick={() => {
            onClose();
            requestSettings('mcp');
          }}
        >
          Manage in Settings
        </button>
        <button type="button" className="btn ghost sm" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
