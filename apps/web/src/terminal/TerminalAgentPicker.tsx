import { useId, useRef } from 'react';
import { LayoutGroup } from 'motion/react';
import {
  DEFAULT_INVOLVEMENT_LEVEL,
  isTrackedTerminalProvider,
  terminalProviderName,
  type NativeTerminalProvider,
  type ProviderCapabilities,
} from '@spark-outpost/contracts';
import { ProviderBlob } from '../brand/ProviderBlob.tsx';
import { ModeOptions } from '../chat/composer/ModeOptions.tsx';
import { PermissionChip } from '../chat/composer/PermissionChip.tsx';
import { ProviderSwitch } from '../chat/composer/ProviderSwitch.tsx';
import { modePermission } from '../chat/composer/mode-summary.ts';
import '../chat/composer/model-picker.css';
import './native-terminal.css';
import { FreezeWhileHidden } from '../ui/FreezeWhileHidden.tsx';
import { ChevronIcon, TerminalIcon } from '../ui/icons.tsx';
import { RadioRow } from '../ui/RadioRow.tsx';
import { usePopover } from '../ui/use-popover.ts';
import {
  CODEX_ASK_UNAVAILABLE,
  TERMINAL_AGENTS,
  UNTRACKED_NOTE,
  terminalModeBlocked,
  terminalModes,
  useOtherTerminalAgents,
} from './terminal-agents.ts';

interface TerminalAgentPickerProps {
  provider: NativeTerminalProvider;
  onProvider: (provider: NativeTerminalProvider) => void;
  capabilities: ProviderCapabilities | undefined;
  loading: boolean;
  mode: string | null;
  onMode: (mode: string) => void;
  disabled: boolean;
}

function OtherAgents({
  provider,
  onProvider,
}: {
  provider: NativeTerminalProvider;
  onProvider: (provider: NativeTerminalProvider) => void;
}) {
  const prefix = useId();
  const agents = useOtherTerminalAgents();
  if (!agents.data?.length) return null;
  return (
    <div className="picker-pane native-others">
      <p className="mgroup" id={`${prefix}-others`}>
        Other agents
      </p>
      <div className="rlist" role="radiogroup" aria-labelledby={`${prefix}-others`}>
        {agents.data.map((agent) => (
          <RadioRow
            key={agent.id}
            id={`${prefix}-${agent.id}`}
            label={agent.name}
            hint={null}
            tag={agent.installed ? null : 'Not installed'}
            checked={agent.id === provider}
            disabled={!agent.installed}
            onSelect={() => onProvider(agent.id)}
          />
        ))}
      </div>
    </div>
  );
}

export function TerminalAgentPicker({
  provider,
  onProvider,
  capabilities,
  loading,
  mode,
  onMode,
  disabled,
}: TerminalAgentPickerProps) {
  const { open, setOpen, toggle, anchorRef, panelRef, returnFocusRef } = usePopover<
    HTMLDivElement,
    HTMLDivElement
  >();
  const agentButton = useRef<HTMLButtonElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const name = terminalProviderName(provider);
  const tracked = isTrackedTerminalProvider(provider) ? provider : null;
  const modes = terminalModes(provider, capabilities?.modes ?? []);
  const blocked = terminalModeBlocked(provider, mode);
  const permission = mode ? modePermission(provider, mode, capabilities) : null;
  const openFrom = (trigger: HTMLButtonElement | null) => {
    returnFocusRef.current = trigger;
    toggle();
  };
  return (
    <div className="mpicker">
      <div ref={anchorRef} className="mtriggers">
        <button
          ref={agentButton}
          type="button"
          className="mbtn"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`Terminal agent: ${name}`}
          disabled={disabled}
          onClick={() => openFrom(agentButton.current)}
        >
          {tracked ? (
            <ProviderBlob providerId={tracked} size={18} animate="hover" />
          ) : (
            <TerminalIcon />
          )}
          <span className="mname">{name}</span>
          <ChevronIcon />
        </button>
        {permission && !disabled && (
          <PermissionChip
            ref={chip}
            state={permission}
            hint={blocked ? CODEX_ASK_UNAVAILABLE : (permission.description ?? permission.label)}
            expanded={open}
            panelId={panelId}
            onClick={() => openFrom(chip.current)}
          />
        )}
      </div>
      <div
        ref={panelRef}
        id={panelId}
        className={open ? 'mpop picker open' : 'mpop picker'}
        role="dialog"
        aria-label="Terminal agent and permissions"
      >
        <FreezeWhileHidden hidden={!open}>
          <LayoutGroup id={panelId}>
            <div className="picker-top">
              <span className="picker-title">
                {name}
                <small>Runs in this terminal</small>
              </span>
              <ProviderSwitch
                providers={TERMINAL_AGENTS}
                active={tracked}
                onSelect={(id) => onProvider(id as NativeTerminalProvider)}
              />
            </div>
            <div
              className={
                tracked ? 'picker-pane native-modes' : 'picker-pane native-modes untracked'
              }
            >
              {!tracked ? (
                <p className="mempty">{UNTRACKED_NOTE}</p>
              ) : mode ? (
                <ModeOptions
                  provider={provider}
                  modes={modes}
                  defaultMode={capabilities?.defaultMode ?? null}
                  selected={blocked ? null : mode}
                  level={DEFAULT_INVOLVEMENT_LEVEL}
                  hasRepos={false}
                  loading={loading}
                  onMode={(next) => {
                    onMode(next);
                    setOpen(false);
                    (returnFocusRef.current ?? agentButton.current)?.focus();
                  }}
                />
              ) : (
                <p className="mempty">
                  {loading
                    ? 'Asking the agent for its modes…'
                    : `${name} starts with its default mode.`}
                </p>
              )}
              {blocked && (
                <p className="mode-warn" role="status">
                  {CODEX_ASK_UNAVAILABLE}
                </p>
              )}
            </div>
            <OtherAgents provider={provider} onProvider={onProvider} />
          </LayoutGroup>
        </FreezeWhileHidden>
        <div className="picker-foot">Native commands use the agent’s permissions.</div>
      </div>
    </div>
  );
}
