import './tools-panel.css';
import '../../settings/mcp/mcp.css';
import { useEffect, useId, useRef, type RefObject } from 'react';
import type { Project } from '@spark-outpost/contracts';
import { useRemoteClient } from '../../phone/use-remote-client.ts';
import { requestSettings } from '../../settings/settings-request.ts';
import { QueryWait } from '../../ui/loading/QueryWait.tsx';
import { Skeleton } from '../../ui/loading/Skeleton.tsx';
import { ChatMcpRows } from '../composer/ChatMcpRows.tsx';
import { useChatMcp } from '../composer/use-chat-mcp.ts';
import { ConnectorTools } from './ConnectorTools.tsx';
import { PluginTools } from './PluginTools.tsx';
import { ProjectTools } from './ProjectTools.tsx';

interface ToolsPanelProps {
  conversationId: string;
  repos: readonly Project[];
  provider: string | null;
  onClose: () => void;
}

function useDismiss(panel: RefObject<HTMLDivElement | null>, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    panel.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onCloseRef.current();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [panel]);
}

function McpTools({ conversationId }: { conversationId: string }) {
  const { servers, toggle, setForChat } = useChatMcp(conversationId);
  const list = servers.data?.servers ?? [];
  return (
    <div className="tools-group">
      <h4 className="tools-sub">
        MCP servers <span>this chat</span>
      </h4>
      <QueryWait query={servers} what="MCP servers">
        <Skeleton label="Finding MCP servers" shape="list" rows={2} />
      </QueryWait>
      {servers.data && list.length === 0 && (
        <p className="tools-note">None yet. Add or import them in Settings.</p>
      )}
      {list.length > 0 && <ChatMcpRows servers={list} busy={toggle.isPending} onSet={setForChat} />}
      {toggle.isError && (
        <p className="mcp-error" role="alert">
          {toggle.error.message}
        </p>
      )}
    </div>
  );
}

export function ToolsPanel({ conversationId, repos, provider, onClose }: ToolsPanelProps) {
  const { remote } = useRemoteClient();
  const showPlugins = provider === 'claude' && !remote;
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useDismiss(panelRef, onClose);
  return (
    <div
      ref={panelRef}
      className="mpop left mcppop tools-panel open"
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      <h2 id={titleId}>Tools in this chat</h2>
      <p>
        Changes apply to the next message.
        {repos.length > 0 && ' Hooks and trust are in Agent setup under the message box.'}
      </p>
      <div className="tools-scroll">
        <ProjectTools repos={repos} />
        <McpTools conversationId={conversationId} />
        {showPlugins && <PluginTools />}
        <ConnectorTools />
      </div>
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
