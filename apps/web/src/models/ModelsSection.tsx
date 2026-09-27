import { useId } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ModelCardsResponse, ProviderCardsView } from '@spark-outpost/contracts';
import { modelCardsApi, modelCardsKey } from '../api/model-cards.ts';
import { ModelCardItem } from './ModelCardItem.tsx';
import './models.css';

function frontierCopy(view: ProviderCardsView): string {
  const names = view.models
    .filter((model) => model.card.tier === 'frontier')
    .map((model) => model.card.label)
    .join(' or ');
  const base = `Lets Jev choose ${names} on Auto when it is very sure (0.95). Pinned chats can always use it.`;
  return view.provider.doMode === 'no'
    ? `${base} ${view.provider.label} only reads here, so this applies to Scouts, Architects and Critics, never to Builders.`
    : base;
}

function FrontierSwitch({ view }: { view: ProviderCardsView }) {
  const hintId = useId();
  const queryClient = useQueryClient();
  const provider = view.provider.provider;
  const save = useMutation({
    mutationFn: (allowed: boolean) => modelCardsApi.setFrontier(provider, allowed),
    onSuccess: (allowFrontier) =>
      queryClient.setQueryData<ModelCardsResponse>(modelCardsKey, (current) =>
        current
          ? {
              ...current,
              providers: current.providers.map((entry) => ({
                ...entry,
                allowFrontier: allowFrontier[entry.provider.provider] ?? false,
              })),
            }
          : current,
      ),
  });
  const checked = save.isPending ? save.variables : view.allowFrontier;
  return (
    <div className="mc-switch">
      <label>
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          aria-describedby={hintId}
          onChange={(event) => save.mutate(event.target.checked)}
        />
        <span>Allow frontier models for {view.provider.label}</span>
      </label>
      <p id={hintId} className="set-hint" aria-live="polite">
        {save.isError ? save.error.message : frontierCopy(view)}
      </p>
    </div>
  );
}

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
      {view.hasFrontier && <FrontierSwitch view={view} />}
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
        What Jev knows about each model when it picks one: vendor facts checked{' '}
        {cards.data.checkedAt}, and what our own benchmark measured.
      </p>
      {cards.data.providers.map((view) => (
        <ProviderModels key={view.provider.provider} view={view} />
      ))}
    </>
  );
}
