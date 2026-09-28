import './mcp-scan.css';
import { useId, useState } from 'react';
import type { McpScanSource } from '@spark-outpost/contracts';
import { countLabel } from '../../ui/count-label.ts';
import { ChevronIcon, XIcon } from '../../ui/icons.tsx';
import { shortHome } from './mcp-command-line.ts';
import { scanLine } from './mcp-labels.ts';

interface McpScanSummaryProps {
  sources: readonly McpScanSource[];
  onDismiss: () => void;
}

export function McpScanSummary({ sources, onDismiss }: McpScanSummaryProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const files = sources.filter((source) => source.found);
  const warnings = files.reduce((sum, source) => sum + source.warnings.length, 0);

  return (
    <div className={open ? 'mcp-scan open' : 'mcp-scan'} role="status">
      <div className="mcp-scan-row">
        <p>
          {scanLine(sources)}
          {warnings > 0 && <span className="mcp-bad"> · {countLabel(warnings, 'warning')}</span>}
        </p>
        {files.length > 0 && (
          <button
            type="button"
            className="mcp-disclose"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen(!open)}
          >
            Details
            <ChevronIcon />
          </button>
        )}
        <button
          type="button"
          className="mcp-icon-btn"
          aria-label="Dismiss scan result"
          onClick={onDismiss}
        >
          <XIcon />
        </button>
      </div>
      {open && (
        <div id={listId}>
          <p className="mcp-scan-note">Nothing was run; imported servers start off.</p>
          <ul>
            {files.map((source) => (
              <li key={source.path}>
                <b>{source.label}</b>
                <span>{countLabel(source.servers, 'server')}</span>
                <code title={source.path}>{shortHome(source.path)}</code>
                {source.warnings.map((warning) => (
                  <small key={warning} className="mcp-bad">
                    {warning}
                  </small>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
