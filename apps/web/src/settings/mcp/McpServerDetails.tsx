import { useId, useState } from 'react';
import type { UserMcpServer } from '@spark-outpost/contracts';
import { ChevronIcon, CopyIcon } from '../../ui/icons.tsx';
import { useTooltip } from '../../ui/Tooltip.tsx';
import { copyButtonText, useCopyFeedback } from '../../ui/use-copy-feedback.ts';
import { countLabel } from '../../ui/count-label.ts';
import { shortHome } from './mcp-command-line.ts';
import { targetLine } from './mcp-labels.ts';

function CommandLine({ server }: { server: UserMcpServer }) {
  const full = targetLine(server);
  const { triggerProps, tooltip } = useTooltip(full);
  const { state, copy } = useCopyFeedback();
  const what = server.transport === 'stdio' ? 'command' : 'URL';
  const copyLabel = state === 'idle' ? `Copy ${what}` : copyButtonText(state);
  return (
    <div className="mcp-line">
      <span className="mcp-line-label">{server.transport === 'stdio' ? 'Command' : 'URL'}</span>
      <code className="mcp-cmd" {...triggerProps}>
        {shortHome(full)}
      </code>
      {tooltip}
      <button
        type="button"
        className={`mcp-icon-btn${state === 'copied' ? ' done' : ''}`}
        aria-label={copyLabel}
        title={copyLabel}
        onClick={() => copy(full)}
      >
        <CopyIcon />
      </button>
    </div>
  );
}

function NameList({ server }: { server: UserMcpServer }) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const stdio = server.transport === 'stdio';
  const names = stdio ? server.envNames : server.headerNames;
  if (names.length === 0) return null;
  const label = stdio
    ? countLabel(names.length, 'environment variable')
    : countLabel(names.length, 'header');
  return (
    <div className="mcp-line mcp-names">
      <span className="mcp-line-label">{stdio ? 'Env' : 'Headers'}</span>
      <button
        type="button"
        className="mcp-disclose"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(!open)}
      >
        {label}
        <ChevronIcon />
      </button>
      {open && (
        <ul id={listId} aria-label={stdio ? 'Environment variables' : 'Headers'}>
          {names.map((name) => (
            <li key={name}>
              <code>{name}</code>
              {server.secretNames.includes(name) && <small>in keychain</small>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function McpServerDetails({ server }: { server: UserMcpServer }) {
  return (
    <div className="mcp-lines">
      <CommandLine server={server} />
      <NameList server={server} />
    </div>
  );
}
