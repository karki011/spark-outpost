import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ProviderCardsView } from '@spark-outpost/contracts';
import { modelCardsApi, modelCardsKey } from '../api/model-cards.ts';
import { ProviderBlob } from '../brand/ProviderBlob.tsx';
import { InfoTip } from '../ui/InfoTip.tsx';
import {
  cardsNote,
  ALL_PROVIDERS,
  readSavedProvider,
  shownProvider,
  writeSavedProvider,
  type ModelSort,
} from './model-list.ts';
import { ModelsTable } from './ModelsTable.tsx';
import { ProviderChips } from './ProviderChips.tsx';
import { ProviderSummary } from './ProviderSummary.tsx';
import './models.css';
import { QueryWait } from '../ui/loading/QueryWait.tsx';
import { Skeleton } from '../ui/loading/Skeleton.tsx';

interface ProviderModelsProps {
  view: ProviderCardsView;
  sort: ModelSort | null;
  onSort: (sort: ModelSort | null) => void;
}

function ProviderModels({ view, sort, onSort }: ProviderModelsProps) {
  const headingId = useId();
  return (
    <section className="mc-provider" aria-labelledby={headingId}>
      <div className="mc-head">
        <ProviderBlob
          providerId={view.provider.provider}
          size={26}
          expression={view.connected ? 'idle' : 'sleepy'}
        />
        <h4 id={headingId}>{view.provider.label}</h4>
        {!view.connected && <span className="mc-tag">not connected</span>}
      </div>
      <ProviderSummary card={view.provider} />
      <ModelsTable view={view} sort={sort} onSort={onSort} />
      {view.uncardedModels.length > 0 && (
        <p className="mc-warn" role="note">
          No card for {view.uncardedModels.map((model) => model.label).join(', ')}: Jev sees the
          agent’s own description, and the tier comes from the model’s name.
        </p>
      )}
    </section>
  );
}

export function ModelsSection() {
  const cards = useQuery({ queryKey: modelCardsKey, queryFn: modelCardsApi.get });
  const [saved, setSaved] = useState(readSavedProvider);
  const [sort, setSort] = useState<ModelSort | null>(null);
  if (!cards.data) {
    return (
      <QueryWait query={cards} what="model cards">
        <Skeleton label="Reading model cards" shape="cards" rows={3} />
      </QueryWait>
    );
  }
  const providers = cards.data.providers;
  const selected = shownProvider(
    saved,
    providers.map((view) => view.provider.provider),
  );
  const shown =
    selected === ALL_PROVIDERS
      ? providers
      : providers.filter((view) => view.provider.provider === selected);
  const choose = (provider: string) => {
    setSaved(provider);
    writeSavedProvider(provider);
  };
  return (
    <div className="mc">
      <p className="lede">
        The models each agent offers. Open one for cost and benchmark results.
        <InfoTip
          topic="model cards"
          doc={{ page: 'providers-and-models', heading: 'read-the-model-cards' }}
          text={cardsNote(cards.data.checkedAt)}
        />
      </p>
      <ProviderChips providers={providers} value={selected} onChange={choose} />
      {shown.map((view) => (
        <ProviderModels key={view.provider.provider} view={view} sort={sort} onSort={setSort} />
      ))}
    </div>
  );
}
