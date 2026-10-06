import { useId } from 'react';
import type { CompanionStatus, IslandSize } from '../desktop/desktop-bridge.ts';
import { DEFAULT_ISLAND_SIZE, ISLAND_SIZES } from '../island/island-size.ts';
import { Segmented } from '../ui/Segmented.tsx';
import { SettingRow } from './SettingRow.tsx';

const LABEL = 'Spark Island size';

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
      label={LABEL}
      doc={{ page: 'desktop-companion' }}
      hint="Full shows the current chat and what it is doing. Small, Medium and Large show only Scout."
      hintId={hintId}
    >
      <Segmented
        ariaLabel={LABEL}
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
