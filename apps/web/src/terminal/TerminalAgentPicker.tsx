import { useId, useRef } from 'react';
import { LayoutGroup } from 'motion/react';
import {
  DEFAULT_INVOLVEMENT_LEVEL,
  type NativeTerminalProvider,
  type ProviderCapabilities,
} from '@spark-outpost/contracts';
import { ProviderBlob } from '../brand/ProviderBlob.tsx';
import { ModeOptions } from '../chat/composer/ModeOptions.tsx';
import { PermissionChip } from '../chat/composer/PermissionChip.tsx';
import { ProviderSwitch } from '../chat/composer/ProviderSwitch.tsx';
import { modePermission } from '../chat/composer/mode-summary.ts';
import '../chat/composer/model-picker.css';
import { FreezeWhileHidden } from '../ui/FreezeWhileHidden.tsx';
import { ChevronIcon } from '../ui/icons.tsx';
import { usePopover } from '../ui/use-popover.ts';
import {
  CODEX_ASK_UNAVAILABLE,
  TERMINAL_AGENTS,
  terminalAgentName,
  terminalModeBlocked,
  terminalModes,
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
  const name = terminalAgentName(provider);
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
          <ProviderBlob providerId={provider} size={18} animate="hover" />
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
                active={provider}
                onSelect={(id) => onProvider(id as NativeTerminalProvider)}
              />
            </div>
            <div className="picker-pane native-modes">
              {mode ? (
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
          </LayoutGroup>
        </FreezeWhileHidden>
        <div className="picker-foot">Native commands use the agent’s permissions.</div>
      </div>
    </div>
  );
}
