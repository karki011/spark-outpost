import { useId, useState, type ReactNode } from 'react';
import { ChevronIcon } from '../ui/icons.tsx';

const STORE_KEY = 'spark-outpost.remote.open';

function readOpen(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeOpen(key: string, open: boolean): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...readOpen(), [key]: open }));
  } catch {
    return;
  }
}

export function useRememberedOpen(key: string, initial: boolean): [boolean, () => void] {
  const [open, setOpen] = useState(() => readOpen()[key] ?? initial);
  const toggle = () => {
    writeOpen(key, !open);
    setOpen(!open);
  };
  return [open, toggle];
}

interface DisclosureProps {
  open: boolean;
  controls: string;
  onToggle: () => void;
  children: ReactNode;
}

export function Disclosure({ open, controls, onToggle, children }: DisclosureProps) {
  return (
    <button
      type="button"
      className="ph-disclose"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
      <ChevronIcon />
      {children}
    </button>
  );
}

interface PhoneSectionProps {
  id: string;
  title: string;
  count?: number | undefined;
  summary?: ReactNode;
  actions?: ReactNode;
  lead?: ReactNode;
  initiallyOpen?: boolean;
  className?: string;
  children: ReactNode;
}

export function PhoneSection({
  id,
  title,
  count,
  summary,
  actions,
  lead,
  initiallyOpen = true,
  className,
  children,
}: PhoneSectionProps) {
  const [open, toggle] = useRememberedOpen(id, initiallyOpen);
  const titleId = useId();
  const bodyId = useId();
  return (
    <section
      className={['ph-card', 'ph-section', className].filter(Boolean).join(' ')}
      data-open={open}
      aria-labelledby={titleId}
    >
      <div className="ph-section-head">
        <h2>
          <Disclosure open={open} controls={bodyId} onToggle={toggle}>
            <span id={titleId}>{title}</span>
            {count !== undefined && count > 0 && <span className="ph-count">{count}</span>}
          </Disclosure>
        </h2>
        {(summary || actions) && (
          <div className="ph-section-side">
            {summary}
            {actions}
          </div>
        )}
      </div>
      {lead}
      <div id={bodyId} className="ph-section-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

interface PhoneGroupProps {
  id: string;
  title: string;
  description: string;
  count: string;
  as?: 'group' | 'region';
  children: ReactNode;
}

export function PhoneGroup({
  id,
  title,
  description,
  count,
  as = 'group',
  children,
}: PhoneGroupProps) {
  const [open, toggle] = useRememberedOpen(id, false);
  const headingId = useId();
  const bodyId = useId();
  const head = (
    <div className="ph-group-head">
      <h3>
        <Disclosure open={open} controls={bodyId} onToggle={toggle}>
          <span id={headingId}>{title}</span>
        </Disclosure>
      </h3>
      <span className="ph-pill">{count}</span>
      <p>{description}</p>
    </div>
  );
  const body = (
    <div id={bodyId} className="ph-group-body" hidden={!open}>
      {children}
    </div>
  );
  if (as === 'region') {
    return (
      <section className="ph-group" data-open={open} aria-labelledby={headingId}>
        {head}
        {body}
      </section>
    );
  }
  return (
    <div className="ph-group" data-open={open} role="group" aria-labelledby={headingId}>
      {head}
      {body}
    </div>
  );
}
