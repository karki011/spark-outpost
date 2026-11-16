import { useId, useState } from 'react';
import type { Project } from '@spark-outpost/contracts';
import { requestSettings } from '../../settings/settings-request.ts';
import { useChatMcp } from '../composer/use-chat-mcp.ts';
import { ToolsGroups } from '../tools/ToolsGroups.tsx';

interface RailToolsProps {
  conversationId: string;
  repos: readonly Project[];
  provider: string | null;
}

function serversLine(on: number): string {
  if (on === 0) return 'No MCP servers on';
  return on === 1 ? '1 MCP server on' : `${on} MCP servers on`;
}

export function RailTools({ conversationId, repos, provider }: RailToolsProps) {
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  const { servers } = useChatMcp(conversationId);
  const on = (servers.data?.servers ?? []).filter((server) => server.enabled).length;
  return (
    <section className="crail-section crail-tools" aria-label="Tools">
      <div className="crail-head">
        <button
          type="button"
          className="crail-fold"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen(!open)}
        >
          <span className="crail-title">Tools</span>
          {!open && (
            <span className="crail-detail">
              {servers.data ? serversLine(on) : 'MCP servers, plugins and skills'}
            </span>
          )}
          <span className="crail-chevron" data-open={open || undefined} aria-hidden="true">
            ›
          </span>
        </button>
        {open && (
          <button
            type="button"
            className="tools-link crail-manage"
            onClick={() => requestSettings('mcp')}
          >
            Manage
          </button>
        )}
      </div>
      <div id={bodyId} hidden={!open}>
        <p className="tools-note crail-tools-note">Changes apply to the next message.</p>
        <ToolsGroups
          conversationId={conversationId}
          repos={repos}
          provider={provider}
          className="crail-tools-body"
        />
      </div>
    </section>
  );
}
