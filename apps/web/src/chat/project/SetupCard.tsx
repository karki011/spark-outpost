import { useId, type ReactNode } from 'react';
import type { RepoAgentConfig } from '@spark-outpost/contracts';
import type { AgentConfigChange } from './use-agent-config.ts';

export interface SetupCardsProps {
  config: RepoAgentConfig;
  name: string;
  busy: boolean;
  onChange: (change: AgentConfigChange) => void;
}

interface SetupSwitchProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  id?: string;
  describedBy?: string;
  onChange: (checked: boolean) => void;
}

export function SetupSwitch({
  label,
  checked,
  disabled = false,
  id,
  describedBy,
  onChange,
}: SetupSwitchProps) {
  return (
    <label className="as-switch">
      <input
        id={id}
        type="checkbox"
        role="switch"
        aria-label={label}
        aria-describedby={describedBy}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="as-track" aria-hidden="true" />
    </label>
  );
}

interface SetupCardProps {
  title: string;
  count?: number;
  status?: string | undefined;
  toggle?: SetupSwitchProps | undefined;
  tone?: 'warn';
  children?: ReactNode;
}

export function SetupCard({ title, count, status, toggle, tone, children }: SetupCardProps) {
  const headingId = useId();
  return (
    <section className={tone ? `as-card ${tone}` : 'as-card'} aria-labelledby={headingId}>
      <div className="as-head">
        <h3 id={headingId}>
          {title}
          {count !== undefined && <span className="as-count">{count}</span>}
        </h3>
        {status && <span className="as-status">{status}</span>}
        {toggle && <SetupSwitch {...toggle} />}
      </div>
      {children}
    </section>
  );
}

interface SetupListProps {
  label: string;
  items: { key: string; name: string; detail?: string | undefined }[];
  preview?: number;
}

export function SetupList({ label, items, preview = 3 }: SetupListProps) {
  if (items.length === 0) return null;
  const row = (item: SetupListProps['items'][number]) => (
    <li key={item.key}>
      <code>{item.name}</code>
      {item.detail && <small>{item.detail}</small>}
    </li>
  );
  if (items.length <= preview) return <ul className="as-list">{items.map(row)}</ul>;
  return (
    <details className="as-more">
      <summary>
        Show {items.length} {label}
      </summary>
      <ul className="as-list">{items.map(row)}</ul>
    </details>
  );
}
