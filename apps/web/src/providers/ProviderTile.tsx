import { useId, type Ref } from 'react';
import { motion } from 'motion/react';
import type { AdvisorSetup, ProviderSetup } from '@spark-outpost/contracts';
import { ProviderMark } from '../brand/ProviderMark.tsx';
import { ChevronIcon } from '../ui/icons.tsx';
import { StatusChip } from './StatusChip.tsx';
import type { TileStatus } from './tile-status.ts';

interface ProviderTileProps {
  setup: ProviderSetup | AdvisorSetup;
  status: TileStatus;
  model: string | null;
  isDefault: boolean;
  tileRef: Ref<HTMLButtonElement>;
  onOpen: () => void;
}

export function ProviderTile({
  setup,
  status,
  model,
  isDefault,
  tileRef,
  onOpen,
}: ProviderTileProps) {
  const id = useId();
  return (
    <li>
      <button
        ref={tileRef}
        type="button"
        className={`ptile ${status.tone}`}
        data-prov={setup.id}
        aria-labelledby={`${id}-name ${id}-status`}
        aria-describedby={`${id}-detail`}
        onClick={onOpen}
      >
        <span className="ptile-top">
          <motion.span className="plogo" layoutId={`pblob-${setup.id}`}>
            <ProviderMark providerId={setup.id} size={42} />
          </motion.span>
          <span className="ptile-name">
            <b id={`${id}-name`}>
              {setup.name}
              {isDefault && <span className="tag-default">Default</span>}
            </b>
            <small>by {setup.maker}</small>
          </span>
          <ChevronIcon />
        </span>
        <StatusChip status={status} id={`${id}-status`} />
        <span className="ptile-detail" id={`${id}-detail`}>
          {model && (
            <span className="ptile-model">
              Model <b>{model}</b>
            </span>
          )}
          <span className="ptile-hint">{status.hint}</span>
        </span>
      </button>
    </li>
  );
}
