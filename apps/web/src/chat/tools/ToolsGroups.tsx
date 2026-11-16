import '../../settings/mcp/mcp.css';
import './tools-panel.css';
import type { Project } from '@spark-outpost/contracts';
import { useRemoteClient } from '../../phone/use-remote-client.ts';
import { QueryWait } from '../../ui/loading/QueryWait.tsx';
import { Skeleton } from '../../ui/loading/Skeleton.tsx';
import { ChatMcpRows } from '../composer/ChatMcpRows.tsx';
import { useChatMcp } from '../composer/use-chat-mcp.ts';
import { ConnectorTools } from './ConnectorTools.tsx';
import { PluginTools } from './PluginTools.tsx';
import { ProjectTools } from './ProjectTools.tsx';

interface ToolsGroupsProps {
  conversationId: string;
  repos: readonly Project[];
  provider: string | null;
  className?: string;
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

export function ToolsGroups({ conversationId, repos, provider, className }: ToolsGroupsProps) {
  const { remote } = useRemoteClient();
  const showPlugins = provider === 'claude' && !remote;
  return (
    <div className={className ? `tools-groups ${className}` : 'tools-groups'}>
      <ProjectTools repos={repos} />
      <McpTools conversationId={conversationId} />
      {showPlugins && <PluginTools />}
      <ConnectorTools />
    </div>
  );
}
