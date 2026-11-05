import {
  MCP_NEW_SESSIONS_NOTE,
  MCP_SWITCH_PLACE_LABELS,
  type McpServerAction,
} from '@spark-outpost/contracts';
import { requestSettings } from '../settings-request.ts';
import { targetLine } from './mcp-labels.ts';

const TRANSPORT_LABELS = {
  stdio: 'Command on your computer',
  http: 'HTTP server',
  sse: 'SSE server',
} as const;

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  transport: 'Type',
  command: 'Command',
  args: 'Arguments',
  url: 'URL',
  envNames: 'Environment variables',
  headerNames: 'Headers',
};

const TURN_ON_LABELS = {
  all_chats: 'On for all chats',
  this_chat: 'On for this chat',
  off: 'Off until you turn it on',
} as const;

export function isMcpAction(action: { action: string }): action is McpServerAction {
  return action.action.endsWith('_mcp_server');
}

export function McpSettingsButton() {
  return (
    <button type="button" className="sac-link" onClick={() => requestSettings('mcp')}>
      Open MCP servers
    </button>
  );
}

function after(action: McpServerAction): string | null {
  if (action.action === 'add_mcp_server') {
    return action.needsValues.length > 0
      ? 'Off until you fill its values and turn it on'
      : TURN_ON_LABELS[action.turnOn];
  }
  if (action.action === 'update_mcp_server') {
    return action.keepsOn ? 'Stays on where it is on now' : null;
  }
  if (action.action === 'remove_mcp_server') {
    return 'Removed with its saved values, everywhere it is on';
  }
  const place =
    action.place === 'project'
      ? `Project ${action.project?.name ?? ''}`
      : MCP_SWITCH_PLACE_LABELS[action.place];
  const state = action.state === 'inherit' ? 'follows the wider setting' : action.state;
  return `${place}: ${state}`;
}

export function McpActionFacts({ action }: { action: McpServerAction }) {
  const stdio = action.transport === 'stdio';
  const names = stdio ? action.envNames : action.headerNames;
  const outcome = after(action);
  return (
    <>
      <dl className="sac-facts">
        <dt>Server</dt>
        <dd>
          {action.name} · {TRANSPORT_LABELS[action.transport]}
        </dd>
        {action.action === 'update_mcp_server' && (
          <>
            <dt>Changes</dt>
            <dd>{action.changed.map((field) => FIELD_LABELS[field] ?? field).join(', ')}</dd>
          </>
        )}
        <dt>{stdio ? 'Runs' : 'URL'}</dt>
        <dd>
          <code className="mcp-fact-cmd">{targetLine(action)}</code>
        </dd>
        {names.length > 0 && (
          <>
            <dt>{stdio ? 'Environment' : 'Headers'}</dt>
            <dd>
              {names.map((name) => (
                <code key={name} className="mcp-fact-name">
                  {name}
                </code>
              ))}
            </dd>
          </>
        )}
        {outcome && (
          <>
            <dt>After</dt>
            <dd>{outcome}</dd>
          </>
        )}
      </dl>
      {stdio && action.action !== 'remove_mcp_server' && (
        <p className="appr-reason">
          This command runs on your computer whenever a chat that uses the server starts. Check it
          before you confirm.
        </p>
      )}
      {action.needsValues.length > 0 && action.action !== 'remove_mcp_server' && (
        <p className="sac-note">
          Needs a value for {action.needsValues.join(', ')}. Agents never see or set the values;
          fill them in Settings → MCP servers. <McpSettingsButton />
        </p>
      )}
      <p className="sac-note">{MCP_NEW_SESSIONS_NOTE}</p>
    </>
  );
}
