import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ProviderCardsView } from '@spark-outpost/contracts';
import { modelCardsApi, modelCardsKey } from '../api/model-cards.ts';
import { ProviderBlob } from '../brand/ProviderBlob.tsx';
import { InfoTip } from '../ui/InfoTip.tsx';
import { ModelCardItem } from './ModelCardItem.tsx';
import {
  ALL_PROVIDERS,
  orderModels,
  readSavedProvider,
  shownProvider,
  writeSavedProvider,
} from './model-list.ts';
import { ProviderChips } from './ProviderChips.tsx';
import { ProviderSummary } from './ProviderSummary.tsx';
import './models.css';

function ProviderModels({ view }: { view: ProviderCardsView }) {
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
      <ul className="mc-grid">
        {orderModels(view.models).map((model) => (
          <ModelCardItem key={model.card.id} view={model} />
        ))}
      </ul>
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
  if (cards.isError) return <p className="set-hint">{cards.error.message}</p>;
  if (!cards.data) return <p className="set-hint">Loading model cards…</p>;
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
        What each model costs, how it did on our benchmark, and when Spark uses it.
        <InfoTip
          topic="model cards"
          doc={{ page: 'providers-and-models', heading: 'read-the-model-cards' }}
          text={`Vendor facts checked ${cards.data.checkedAt}. The rules pick models; Jev only reads these cards.`}
        />
      </p>
      <ProviderChips providers={providers} value={selected} onChange={choose} />
      {shown.map((view) => (
        <ProviderModels key={view.provider.provider} view={view} />
      ))}
    </div>
  );
}
