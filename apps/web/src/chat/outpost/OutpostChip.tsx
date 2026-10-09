import './outpost-chat.css';
import { OutpostIcon } from '../../ui/icons.tsx';
import { useTooltip } from '../../ui/Tooltip.tsx';

interface OutpostChipProps {
  name: string;
  handle: string;
  onOpen?: (() => void) | undefined;
}

export function OutpostChip({ name, handle, onOpen }: OutpostChipProps) {
  const where = `This chat is @${handle} in ${name}`;
  const tip = useTooltip(where, { side: 'top' });
  const content = (
    <>
      <OutpostIcon />
      <span className="ctx-name">{name}</span>
      <span className="ctx-handle">@{handle}</span>
    </>
  );
  if (!onOpen) {
    return (
      <span className="ctx-outpost" title={where}>
        {content}
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        className="ctx-outpost"
        aria-label={`Open outpost ${name}. ${where}`}
        {...tip.triggerProps}
        onClick={onOpen}
      >
        {content}
      </button>
      {tip.tooltip}
    </>
  );
}
