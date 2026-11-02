import { useEffect, useId, useRef, useState } from 'react';
import type { UserPlugin } from '@spark-outpost/contracts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { HoldToConfirm } from '../ui/HoldToConfirm.tsx';
import { ChevronIcon } from '../ui/icons.tsx';
import { confirmText, isChecking, isOn, needsConfirm, pluginAdds } from './plugin-model.ts';
import { PluginDetails } from './PluginDetails.tsx';
import { PluginStatus } from './PluginStatus.tsx';
import { usePluginSwitch } from './use-user-plugins.ts';

function rowHint(plugin: UserPlugin, error: string | null): string | null {
  if (error) return error;
  if (!plugin.loadable) return plugin.unloadableReason ?? 'This plugin can’t load in chats.';
  if (plugin.changed) return 'Changed since you turned it on — check again';
  if (isChecking(plugin)) return 'Spark is checking this plugin.';
  return null;
}

function ConfirmOn({
  plugin,
  onConfirm,
  onCancel,
}: {
  plugin: UserPlugin;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>('.hold-btn')?.focus();
  }, []);
  return (
    <div
      ref={box}
      className="plug-confirm"
      role="group"
      aria-label={`Turn on ${plugin.name}`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onCancel();
      }}
    >
      <p>{confirmText(plugin)}</p>
      <HoldToConfirm
        label={`Hold to turn on ${plugin.name}`}
        hint="Turns the plugin on for Claude chats."
        holdingHint="Keep holding. Let go now to cancel."
        releasedHint="Released early. Nothing happened."
        onConfirm={onConfirm}
        adornment={
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
        }
      />
    </div>
  );
}

interface PluginRowProps {
  plugin: UserPlugin;
  open: boolean;
  onToggle: () => void;
}

export function PluginRow({ plugin, open, onToggle }: PluginRowProps) {
  const hintId = useId();
  const switchId = useId();
  const detailsId = useId();
  const [confirming, setConfirming] = useState(false);
  const toggle = usePluginSwitch(plugin);
  const hint = rowHint(plugin, toggle.error);
  const checked = isOn(plugin);
  const disabled = toggle.busy || !plugin.loadable || (!checked && isChecking(plugin));
  const change = (on: boolean) => {
    if (on && needsConfirm(plugin)) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    toggle.set(on);
  };
  const meta = [plugin.version && `v${plugin.version}`, plugin.marketplace].filter(Boolean);
  return (
    <li
      className="plug-row"
      data-checking={isChecking(plugin) || undefined}
      data-open={open || undefined}
    >
      <div className="plug-head">
        <span className="plug-name">
          <b>{plugin.name}</b>
          <small>{meta.join(' · ')}</small>
        </span>
        {plugin.description && (
          <span className="plug-desc" title={plugin.description}>
            {plugin.description}
          </span>
        )}
        <div className="plug-line">
          <span className="plug-adds">{pluginAdds(plugin)}</span>
          <PluginStatus status={plugin.scan.status} />
          <button
            type="button"
            className="plug-more"
            aria-expanded={open}
            aria-controls={open ? detailsId : undefined}
            aria-label={`Details for ${plugin.name}`}
            onClick={onToggle}
          >
            <ChevronIcon />
            Details
          </button>
          <BlobToggle
            id={switchId}
            label={plugin.name}
            checked={checked}
            disabled={disabled}
            describedBy={hintId}
            onChange={change}
          />
        </div>
      </div>
      <p id={hintId} className="set-hint plug-hint" aria-live="polite">
        {hint}
      </p>
      {confirming && (
        <ConfirmOn
          plugin={plugin}
          onCancel={() => {
            setConfirming(false);
            document.getElementById(switchId)?.focus();
          }}
          onConfirm={() => {
            setConfirming(false);
            toggle.set(true, true);
          }}
        />
      )}
      {open && <PluginDetails plugin={plugin} id={detailsId} />}
    </li>
  );
}
