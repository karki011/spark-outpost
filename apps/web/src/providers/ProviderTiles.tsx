import { useEffect, useRef } from 'react';
import type { AdvisorSetup, ConnectableId, ProviderSetup } from '@spark-outpost/contracts';
import { InfoTip } from '../ui/InfoTip.tsx';
import { ProviderTile } from './ProviderTile.tsx';
import type { TileStatus } from './tile-status.ts';

export interface TileItem {
  setup: ProviderSetup | AdvisorSetup;
  status: TileStatus;
  model: string | null;
  isDefault: boolean;
}

interface ProviderTilesProps {
  providers: TileItem[];
  advisors: TileItem[];
  focusId: ConnectableId | null;
  onOpen: (id: ConnectableId) => void;
}

export function ProviderTiles({ providers, advisors, focusId, onOpen }: ProviderTilesProps) {
  const tiles = useRef(new Map<ConnectableId, HTMLButtonElement>());

  useEffect(() => {
    if (focusId) tiles.current.get(focusId)?.focus({ preventScroll: false });
  }, [focusId]);

  const renderTile = (item: TileItem) => (
    <ProviderTile
      key={item.setup.id}
      setup={item.setup}
      status={item.status}
      model={item.model}
      isDefault={item.isDefault}
      tileRef={(element) => {
        if (element) tiles.current.set(item.setup.id, element);
        else tiles.current.delete(item.setup.id);
      }}
      onOpen={() => onOpen(item.setup.id)}
    />
  );

  return (
    <div className="ptiles-view">
      <ul className="ptiles" aria-label="AI providers">
        {providers.map(renderTile)}
      </ul>
      {advisors.length > 0 && (
        <section className="advisors" aria-labelledby="advisors-title">
          <h3 className="advisors-title" id="advisors-title">
            Advisor
          </h3>
          <p className="advisors-note">
            Jev reads each request, asks when it’s unclear and checks finished changes.
            <InfoTip
              topic="Jev"
              text="It never answers chats or approves anything, and is never asked during a turn."
              doc={{ page: 'jev' }}
            />
          </p>
          <ul className="ptiles" aria-label="Advisor">
            {advisors.map(renderTile)}
          </ul>
        </section>
      )}
    </div>
  );
}
