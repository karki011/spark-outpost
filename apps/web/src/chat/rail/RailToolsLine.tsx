import { useChatMcp } from '../composer/use-chat-mcp.ts';

interface RailToolsLineProps {
  conversationId: string;
  onOpen: () => void;
}

function serversLine(on: number): string {
  if (on === 0) return 'No MCP servers on';
  return on === 1 ? '1 MCP server on' : `${on} MCP servers on`;
}

export function RailToolsLine({ conversationId, onOpen }: RailToolsLineProps) {
  const { servers } = useChatMcp(conversationId);
  const on = (servers.data?.servers ?? []).filter((server) => server.enabled).length;
  return (
    <section className="crail-section crail-tools-line" aria-label="Tools">
      <button type="button" className="crail-row" onClick={onOpen}>
        <span className="crail-text">
          <span className="crail-main">Tools</span>
          <span className="crail-detail">
            {servers.data ? serversLine(on) : 'MCP servers, plugins and skills'}
          </span>
        </span>
        <span className="crail-go" aria-hidden="true">
          ›
        </span>
      </button>
    </section>
  );
}
