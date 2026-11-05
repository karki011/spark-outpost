import { useId, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { ChevronIcon } from '../ui/icons.tsx';
import { useReducedMotion } from '../ui/motion.ts';
import { easeOut } from '../ui/transitions.tsx';

interface ConfigSectionProps {
  title: string;
  tone?: 'danger';
  disclosure?: { open: boolean; summary: ReactNode; onToggle: () => void } | undefined;
  children: ReactNode;
}

export function ConfigSection({ title, tone, disclosure, children }: ConfigSectionProps) {
  const id = useId();
  const reduced = useReducedMotion();
  const classes = ['pconf-sec', tone ?? '', disclosure ? 'disclosure' : '']
    .filter(Boolean)
    .join(' ');

  if (!disclosure) {
    return (
      <section className={classes} aria-labelledby={id}>
        <h4 className="pconf-sec-title" id={id}>
          {title}
        </h4>
        {children}
      </section>
    );
  }

  const open = disclosure.open;
  return (
    <section className={open ? `${classes} open` : classes} aria-labelledby={id}>
      <h4 className="pconf-sec-head">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={disclosure.onToggle}
        >
          <span className="pconf-sec-title" id={id}>
            {title}
          </span>
          <span className="pconf-sec-summary">{disclosure.summary}</span>
          <ChevronIcon />
        </button>
      </h4>
      <motion.div
        id={`${id}-body`}
        className="pconf-sec-body"
        initial={false}
        animate={open ? { height: 'auto', opacity: 1 } : { height: 0, opacity: 0 }}
        transition={reduced ? { duration: 0 } : { duration: 0.24, ease: easeOut }}
        inert={!open}
        aria-hidden={!open}
      >
        <div className="pconf-sec-inner">{children}</div>
      </motion.div>
    </section>
  );
}
