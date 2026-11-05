import { useId, useState, type ReactNode } from 'react';
import type { RepoAgentConfig } from '@spark-outpost/contracts';
import { BlobToggle } from '../../brand/BlobToggle.tsx';
import type { AgentConfigChange } from './use-agent-config.ts';

export interface SetupCardsProps {
  config: RepoAgentConfig;
  name: string;
  busy: boolean;
  onChange: (change: AgentConfigChange) => void;
  onOpen?: ((path: string) => void) | undefined;
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
    <BlobToggle
      size="sm"
      label={label}
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      {...(id ? { id } : {})}
      {...(describedBy ? { describedBy } : {})}
    />
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

export interface SetupItem {
  key: string;
  name: string;
  detail?: string | undefined;
  path?: string | undefined;
}

interface SetupListProps {
  label: string;
  items: SetupItem[];
  preview?: number;
  onOpen?: ((path: string) => void) | undefined;
}

function OpenArrow() {
  return (
    <svg className="as-open" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M9 6l6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SetupList({ label, items, preview = 3, onOpen }: SetupListProps) {
  const [all, setAll] = useState(false);
  if (items.length === 0) return null;
  const shown = all ? items : items.slice(0, preview);
  const hidden = items.length - preview;
  const row = (item: SetupItem) => {
    const path = item.path;
    const text = (
      <>
        <code>{item.name}</code>
        {item.detail && <small title={item.detail}>{item.detail}</small>}
      </>
    );
    return (
      <li key={item.key}>
        {onOpen && path ? (
          <button
            type="button"
            className="as-row"
            title={`Open ${path}`}
            onClick={() => onOpen(path)}
          >
            <span className="as-row-text">{text}</span>
            <OpenArrow />
          </button>
        ) : (
          <span className="as-row static">
            <span className="as-row-text">{text}</span>
          </span>
        )}
      </li>
    );
  };
  return (
    <>
      <ul className="as-list" aria-label={label}>
        {shown.map(row)}
      </ul>
      {hidden > 0 && (
        <button type="button" className="as-all" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${items.length} ${label}`}
        </button>
      )}
    </>
  );
}
