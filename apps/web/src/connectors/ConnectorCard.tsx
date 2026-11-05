import '../providers/providers.css';
import './connectors.css';
import { useId, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ConnectorBlob, type ConnectorId } from '../brand/ConnectorBlob.tsx';
import type { BlobExpression } from '../brand/blob-expression.ts';
import { CheckIcon, ChevronIcon } from '../ui/icons.tsx';
import { fadeReveal } from '../ui/transitions.tsx';

export type ConnectorBadge = 'connected' | 'soon' | 'checking' | null;

interface ConnectorCardProps {
  connectorId: ConnectorId;
  name: string;
  icon: ReactNode;
  status: ReactNode;
  badge: ConnectorBadge;
  open?: boolean;
  onToggle?: () => void;
  expression?: BlobExpression;
  children?: ReactNode;
}

function Badge({ badge }: { badge: ConnectorBadge }) {
  if (badge === 'connected') {
    return (
      <span className="pill-ok">
        <CheckIcon />
        Connected
      </span>
    );
  }
  if (badge === 'soon') return <span className="cx-soon">Coming soon</span>;
  if (badge === 'checking') return <span className="cx-sk" aria-hidden="true" />;
  return null;
}

export function ConnectorCard({
  connectorId,
  name,
  icon,
  status,
  badge,
  open = false,
  onToggle,
  expression,
  children,
}: ConnectorCardProps) {
  const bodyId = useId();
  const mood: BlobExpression =
    expression ?? (badge === 'soon' ? 'sleepy' : badge === 'checking' ? 'thinking' : 'idle');
  const head = (
    <>
      <span className="plogo cx-logo">
        <ConnectorBlob
          connectorId={connectorId}
          size={42}
          expression={mood}
          animate={open ? 'always' : 'hover'}
        />
        <span className="cx-glyph">{icon}</span>
      </span>
      <span className="nm">
        <b>{name}</b>
        <small>{status}</small>
      </span>
      <Badge badge={badge} />
    </>
  );
  const classes = ['pcard', 'cx-card', open ? 'open' : '', badge === 'soon' ? 'soon' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <li className={classes} data-connector={connectorId}>
      {onToggle ? (
        <button
          type="button"
          className="pc-head"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          {head}
          <ChevronIcon />
        </button>
      ) : (
        <div className="pc-head">{head}</div>
      )}
      <AnimatePresence initial={false}>
        {open && children && (
          <motion.div key="body" id={bodyId} className="pc-collapse" {...fadeReveal}>
            <div className="pc-body">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}
