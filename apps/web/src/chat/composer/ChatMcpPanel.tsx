import '../../settings/mcp/mcp.css';
import '../project/agent-setup.css';
import { useEffect, useId, useRef } from 'react';
import { requestSettings } from '../../settings/settings-request.ts';
import { QueryWait } from '../../ui/loading/QueryWait.tsx';
import { Skeleton } from '../../ui/loading/Skeleton.tsx';
import { ChatMcpRows } from './ChatMcpRows.tsx';
import { useChatMcp } from './use-chat-mcp.ts';

interface ChatMcpPanelProps {
  conversationId: string;
  onClose: () => void;
}

export function ChatMcpPanel({ conversationId, onClose }: ChatMcpPanelProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const { servers, toggle, setForChat } = useChatMcp(conversationId);
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
      <QueryWait query={servers} what="MCP servers">
        <Skeleton label="Finding MCP servers" shape="list" rows={3} />
      </QueryWait>
      {servers.data && list.length === 0 && (
        <p className="as-empty">No MCP servers yet. Add or import them in Settings.</p>
      )}
      {list.length > 0 && <ChatMcpRows servers={list} busy={toggle.isPending} onSet={setForChat} />}
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
