import { useTooltip } from '../ui/Tooltip.tsx';
import { ChevronIcon } from '../ui/icons.tsx';
import { Glyph } from './ticket-icons.tsx';

interface SectionHeaderProps {
  id: string;
  label: string;
  count: number;
  rule: string;
  attention?: boolean;
  expanded?: boolean;
  onToggle?: (() => void) | undefined;
}

export function SectionHeader({
  id,
  label,
  count,
  rule,
  attention,
  expanded,
  onToggle,
}: SectionHeaderProps) {
  const { triggerProps, tooltip } = useTooltip(rule);
  const title = (
    <>
      <b>{label}</b>
      <span className="n">{count}</span>
    </>
  );
  return (
    <div className={attention && count > 0 ? 'sec-h attn' : onToggle ? 'sec-h' : 'sec-h static'}>
      {onToggle ? (
        <button
          type="button"
          className="sec-t"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={onToggle}
        >
          <ChevronIcon />
          {title}
        </button>
      ) : (
        <span className="sec-t">{title}</span>
      )}
      <button type="button" className="info" aria-label={`About ${label}`} {...triggerProps}>
        <Glyph name="info" size={14} />
      </button>
      {tooltip}
    </div>
  );
}
