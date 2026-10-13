import './terminal-bar.css';
import type { ReactNode } from 'react';
import {
  defaultModeFor,
  type ConversationSummary,
  type NativeTerminalSession,
  type Project,
  type ProviderCapabilities,
} from '@spark-outpost/contracts';
import { PermissionIcon } from '../chat/composer/PermissionChip.tsx';
import { modePermission } from '../chat/composer/mode-summary.ts';
import { repoSummary } from '../chat/project/repo-list.ts';
import { BranchIcon, ExpandIcon, FolderIcon, ShrinkIcon } from '../ui/icons.tsx';
import { TERMINAL_FOCUS_KEYS } from '../ui/Keys.tsx';
import { MAC } from '../ui/shortcuts.ts';
import { useTooltip } from '../ui/Tooltip.tsx';
import { terminalLabel } from './native-state.ts';
import { TerminalCompanion } from './TerminalCompanion.tsx';
import { terminalAgentName } from './terminal-agents.ts';

export type TerminalLink = 'connecting' | 'connected' | 'disconnected';

interface TerminalBarProps {
  chat: ConversationSummary;
  native: NativeTerminalSession | null;
  link: TerminalLink | null;
  repos: readonly Project[];
  capabilities: ProviderCapabilities | undefined;
  note: string | null;
  hint: string | null;
  focus: { focused: boolean; toggle: () => void };
  children: ReactNode;
}

function FocusButton({ focused, toggle }: TerminalBarProps['focus']) {
  const label = focused ? 'Exit focus' : 'Focus terminal';
  const tip = useTooltip(label, { keys: TERMINAL_FOCUS_KEYS });
  return (
    <>
      <button
        type="button"
        className="icon-btn"
        aria-label={label}
        aria-pressed={focused}
        aria-keyshortcuts={MAC ? 'Meta+Shift+F' : 'Control+Shift+F'}
        {...tip.triggerProps}
        onClick={toggle}
      >
        {focused ? <ShrinkIcon /> : <ExpandIcon />}
      </button>
      {tip.tooltip}
    </>
  );
}

export function TerminalBar({
  chat,
  native,
  link,
  repos,
  capabilities,
  note,
  hint,
  focus,
  children,
}: TerminalBarProps) {
  const provider = native?.provider ?? 'claude';
  const state = native?.state ?? 'starting';
  const mode = native ? (native.agentMode ?? defaultModeFor(provider)) : null;
  const permission = mode ? modePermission(provider, mode, capabilities) : null;
  const folder = repos.length > 0 ? repoSummary(repos.map((repo) => repo.name)) : native?.label;
  return (
    <div className="tbar">
      <TerminalCompanion chat={chat} state={state} size={24} />
      <b className="tbar-agent">{terminalAgentName(provider)} · Terminal</b>
      <p className="tbar-state" role="status">
        {terminalLabel(state)}
        {link && link !== 'connected'
          ? ` · ${link === 'connecting' ? 'Connecting' : 'Disconnected'}`
          : ''}
      </p>
      {permission && (
        <span
          className={`pchip risk-${permission.risk} tbar-mode`}
          title={`Mode when the last prompt started: ${permission.label}. The agent’s CLI owns its mode while it runs.`}
        >
          <PermissionIcon risk={permission.risk} />
          <span className="sr-only">Permissions: </span>
          {permission.short}
        </span>
      )}
      {native && folder && (
        <span className="tbar-place" title={native.cwd}>
          <FolderIcon />
          <span className="tbar-name">{folder}</span>
          {chat.branch && (
            <>
              <BranchIcon />
              <span className="tbar-name">{chat.branch}</span>
            </>
          )}
        </span>
      )}
      {hint && <span className="tbar-hint">{hint}</span>}
      <p className="tbar-note" role="status" title={note ?? undefined}>
        {note}
      </p>
      <div className="tbar-actions">
        {children}
        <FocusButton {...focus} />
      </div>
    </div>
  );
}
