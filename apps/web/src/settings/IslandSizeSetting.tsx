import { useId } from 'react';
import type { CompanionStatus, IslandSize } from '../desktop/desktop-bridge.ts';
import { DEFAULT_ISLAND_SIZE, ISLAND_SIZES } from '../island/island-size.ts';
import { Segmented } from '../ui/Segmented.tsx';
import { SettingRow } from './SettingRow.tsx';

export const ISLAND_SIZE_LABEL = 'Spark Island size';

const OPTIONS = ISLAND_SIZES.map(({ id, label }) => ({ id, label }));

function isSize(id: string): id is IslandSize {
  return ISLAND_SIZES.some((size) => size.id === id);
}

export function IslandSizeSetting({
  status,
  onChange,
}: {
  status: CompanionStatus;
  onChange: (size: IslandSize) => void;
}) {
  const hintId = useId();
  return (
    <SettingRow
      label={ISLAND_SIZE_LABEL}
      doc={{ page: 'desktop-companion' }}
      hint="Sets the resting blob size. Hover or click for details."
      hintId={hintId}
    >
      <Segmented
        ariaLabel={ISLAND_SIZE_LABEL}
        describedBy={hintId}
        options={OPTIONS}
        value={status.islandSize ?? DEFAULT_ISLAND_SIZE}
        onChange={(id) => {
          if (isSize(id)) onChange(id);
        }}
      />
    </SettingRow>
  );
}
