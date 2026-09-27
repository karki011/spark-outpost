import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ProviderCardsView } from '@spark-outpost/contracts';
import { modelCardsApi, modelCardsKey } from '../api/model-cards.ts';
import { ModelCardItem } from './ModelCardItem.tsx';
import './models.css';

function ProviderFacts({ view }: { view: ProviderCardsView }) {
  const card = view.provider;
  const asks =
    card.asksBeforeCommands === 'every'
      ? 'before every edit and command'
      : card.asksBeforeCommands === 'outside-sandbox-only'
        ? 'only outside its sandbox'
        : 'never';
  const [from, to] = card.coldStartSeconds;
  return (
    <dl className="mc-facts">
      <dt>Do mode</dt>
      <dd>{card.doMode === 'yes' ? 'Yes, through approvals' : 'No, reads only'}</dd>
      <dt>Asks</dt>
      <dd>{asks}</dd>
      <dt>Sandbox</dt>
      <dd>{card.sandbox}</dd>
      <dt>Resume</dt>
      <dd>{card.resume === 'yes' ? 'Yes' : 'No'}</dd>
      <dt>Review</dt>
      <dd>{card.review === 'yes' ? 'Can review others' : 'No'}</dd>
      <dt>Start-up</dt>
      <dd>
        {from}–{to} s · cost {card.costSource}
      </dd>
    </dl>
  );
}

function ProviderModels({ view }: { view: ProviderCardsView }) {
  const headingId = useId();
  return (
    <section className="mc-provider" aria-labelledby={headingId}>
      <div className="mc-head">
        <h4 id={headingId}>{view.provider.label}</h4>
        {!view.connected && <span className="mc-tag">not connected</span>}
      </div>
      <ProviderFacts view={view} />
      <ul className="mc-list">
        {view.models.map((model) => (
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
  if (cards.isError) return <p className="set-hint">{cards.error.message}</p>;
  if (!cards.data) return <p className="set-hint">Loading model cards…</p>;
  return (
    <>
      <p className="lede">
        Vendor facts checked {cards.data.checkedAt}, and what our own benchmark measured. The rules
        pick models; Jev reads these cards only to record which size it would have used.
      </p>
      {cards.data.providers.map((view) => (
        <ProviderModels key={view.provider.provider} view={view} />
      ))}
    </>
  );
}
