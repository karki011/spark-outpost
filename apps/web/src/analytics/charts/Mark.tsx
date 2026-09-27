import type { FocusEvent, KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { useTooltip } from '../../ui/Tooltip.tsx';

interface MarkProps {
  label: string;
  first: boolean;
  className?: string;
  onActive?: (active: boolean) => void;
  children: ReactNode;
}

type HtmlHandlers = ReturnType<typeof useTooltip>['triggerProps'];

function svgHandlers(props: HtmlHandlers, onActive?: (active: boolean) => void) {
  return {
    'aria-describedby': props['aria-describedby'],
    onPointerEnter: (event: PointerEvent<SVGGElement>) => {
      onActive?.(true);
      props.onPointerEnter(event as unknown as PointerEvent<HTMLElement>);
    },
    onPointerLeave: () => {
      onActive?.(false);
      props.onPointerLeave();
    },
    onPointerDown: props.onPointerDown,
    onFocus: (event: FocusEvent<SVGGElement>) => {
      onActive?.(true);
      props.onFocus(event as unknown as FocusEvent<HTMLElement>);
    },
    onBlur: (event: FocusEvent<SVGGElement>) => {
      onActive?.(false);
      props.onBlur(event as unknown as FocusEvent<HTMLElement>);
    },
  };
}

export function Mark({ label, first, className, onActive, children }: MarkProps) {
  const { triggerProps, tooltip } = useTooltip(label, { side: 'top' });
  return (
    <>
      <g
        data-mark=""
        className={className ? `an-mark ${className}` : 'an-mark'}
        role="img"
        aria-label={label}
        tabIndex={first ? 0 : -1}
        {...svgHandlers(triggerProps, onActive)}
      >
        {children}
      </g>
      {tooltip}
    </>
  );
}

const NEXT_KEYS: Record<string, number> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

export function roveMarks(event: KeyboardEvent<SVGElement>) {
  const marks = [...event.currentTarget.querySelectorAll<SVGGElement>('[data-mark]')];
  const current = marks.indexOf(document.activeElement as SVGGElement);
  if (current < 0 || marks.length === 0) return;
  const last = marks.length - 1;
  const step = NEXT_KEYS[event.key];
  const next =
    step !== undefined
      ? Math.min(last, Math.max(0, current + step))
      : event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? last
          : null;
  if (next === null) return;
  event.preventDefault();
  marks[current]!.setAttribute('tabindex', '-1');
  marks[next]!.setAttribute('tabindex', '0');
  marks[next]!.focus();
}
