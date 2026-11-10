import type { CSSProperties, ReactNode } from 'react';
import { CheckIcon, ClockIcon, SpinnerIcon, WarnIcon } from '../ui/icons.tsx';

export const stagger = (index: number) => ({ '--i': index }) as CSSProperties;

interface HomeCardProps {
  id: string;
  title: string;
  count?: number | undefined;
  action?: ReactNode;
  className?: string;
  busy?: boolean;
  children: ReactNode;
}

export function HomeCard({
  id,
  title,
  count,
  action,
  className = '',
  busy,
  children,
}: HomeCardProps) {
  return (
    <section className={`hcard2 ${className}`.trim()} aria-labelledby={id} aria-busy={busy}>
      <div className="hcard2-h">
        <h2 id={id}>
          {title}
          {count !== undefined && (
            <>
              {' '}
              <span className="n">{count}</span>
            </>
          )}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

interface HomeLeadProps {
  id: string;
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function HomeLead({ id, title, meta, action, className = '', children }: HomeLeadProps) {
  return (
    <section className={`hlead ${className}`.trim()} aria-labelledby={id}>
      <div className="hlead-h">
        <div className="hlead-t">
          <h2 id={id}>{title}</h2>
          {meta && <p className="hlead-meta">{meta}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function LeadGroup({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="hlead-g" role="group" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {children}
    </div>
  );
}

export type StatusTone = 'bad' | 'warn' | 'ok' | 'run' | 'info';

const ICONS: Record<StatusTone, ReactNode> = {
  bad: <WarnIcon />,
  warn: <ClockIcon />,
  ok: <CheckIcon className="" />,
  run: <SpinnerIcon />,
  info: <ClockIcon />,
};

export function StatusLabel({ word, tone }: { word: string; tone: StatusTone }) {
  return (
    <span className={`hstat ${tone}`}>
      <span className="hstat-i" aria-hidden="true">
        {ICONS[tone]}
      </span>
      {word}
    </span>
  );
}

interface HomeRowProps {
  label: ReactNode;
  title: string;
  line?: ReactNode;
  trailing?: ReactNode;
  index?: number;
  dim?: boolean;
  onTitle?: { name: string; open: () => void };
  children?: ReactNode;
}

export function HomeRow({
  label,
  title,
  line,
  trailing,
  index = 0,
  dim,
  onTitle,
  children,
}: HomeRowProps) {
  return (
    <li className={dim ? 'hrow dim' : 'hrow'} style={stagger(index)}>
      <span className="hrow-l">{label}</span>
      <span className="hrow-m">
        <b title={title}>
          {onTitle ? (
            <button
              type="button"
              className="hrow-t"
              aria-label={onTitle.name}
              onClick={onTitle.open}
            >
              {title}
            </button>
          ) : (
            title
          )}
        </b>
        {line && <small>{line}</small>}
        {children}
      </span>
      {trailing && <span className="hrow-a">{trailing}</span>}
    </li>
  );
}

interface RowActionProps {
  label: string;
  name?: string;
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export function RowAction({ label, name, primary, disabled, onClick }: RowActionProps) {
  return (
    <button
      type="button"
      className={primary ? 'btn sm primary' : 'btn sm line'}
      aria-label={name}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function HomeRows({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className="hrows" aria-label={label}>
      {children}
    </ul>
  );
}

export function Quiet({ children }: { children: ReactNode }) {
  return <p className="hquiet">{children}</p>;
}

export function Progress({ percent }: { percent: number | null }) {
  if (percent === null) {
    return (
      <span className="hprog wait" role="progressbar" aria-label="Progress, no plan yet">
        <i />
      </span>
    );
  }
  return (
    <span
      className="hprog"
      role="progressbar"
      aria-label="Plan progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <i style={{ transform: `scaleX(${percent / 100})` }} />
    </span>
  );
}

const SKELETON_WIDTHS = [62, 48, 70];

export function RowsSkeleton() {
  return (
    <ul className="hrows" aria-hidden="true">
      {SKELETON_WIDTHS.map((width) => (
        <li key={width} className="hrow">
          <span className="hrow-l">
            <span className="hsk" style={{ width: 64 }} />
          </span>
          <span className="hrow-m">
            <span className="hsk" style={{ width: `${width}%` }} />
            <span className="hsk" style={{ width: '40%', marginTop: 6 }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function LeadSkeleton() {
  return (
    <section className="hlead" aria-hidden="true" data-testid="home-lead-skeleton">
      <div className="hlead-h">
        <span className="hsk" style={{ width: 160, height: 16 }} />
      </div>
      <RowsSkeleton />
    </section>
  );
}
