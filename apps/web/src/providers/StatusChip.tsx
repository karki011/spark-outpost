import type { Ref } from 'react';
import type { TileStatus } from './tile-status.ts';

export function StatusChip({
  status,
  chipRef,
  id,
}: {
  status: TileStatus;
  chipRef?: Ref<HTMLSpanElement>;
  id?: string;
}) {
  return (
    <span ref={chipRef} id={id} className={`pchip ${status.tone}`}>
      <i aria-hidden="true" />
      {status.label}
    </span>
  );
}
