import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ChatSettings, ModelCard, Run } from '@spark-outpost/contracts';
import { CAPABILITIES_STALE_MS, capabilitiesQuery } from '../../api/client.ts';
import { modelCardsApi, modelCardsKey } from '../../api/model-cards.ts';
import { InfoIcon, XIcon } from '../../ui/icons.tsx';
import { modelSwitchNote, type ModelChoice } from '../../usage/model-switch-cache.ts';
import { useMinute } from '../message-actions/use-minute.ts';
import { useIdleCache } from '../project/chat-cache.ts';
import './model-switch-note.css';

const NO_CARDS: readonly ModelCard[] = [];

interface ModelSwitchNoteProps {
  conversationId: string;
  settings: ChatSettings | null;
  runs: readonly Run[];
}

function previousChoice(runs: readonly Run[]): ModelChoice | null {
  const run = runs.findLast((entry) => !entry.parentRunId);
  return run ? { provider: run.provider, model: run.model, used: run.usedModel ?? null } : null;
}

export function ModelSwitchNote({ conversationId, settings, runs }: ModelSwitchNoteProps) {
  const now = useMinute();
  const last = useIdleCache(conversationId);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const provider = settings?.provider ?? null;
  const cards = useQuery({
    queryKey: modelCardsKey,
    queryFn: modelCardsApi.get,
    enabled: last !== null,
    staleTime: CAPABILITIES_STALE_MS,
  });
  const capabilities = useQuery({
    ...capabilitiesQuery(provider ?? 'claude'),
    staleTime: CAPABILITIES_STALE_MS,
    enabled: provider !== null && last !== null,
  });
  if (!settings) return null;
  const label = capabilities.data?.models.find((model) => model.id === settings.model)?.label;
  const allCards = cards.data?.providers.flatMap((entry) => entry.models.map((view) => view.card));
  const note = modelSwitchNote(
    last,
    previousChoice(runs),
    { provider, model: settings.model, label: label ?? null },
    allCards ?? NO_CARDS,
    now,
  );
  if (!note || note.key === dismissed) return null;
  return (
    <div className="switch-note" role="status">
      <InfoIcon />
      <p>{note.text}</p>
      <button
        type="button"
        className="icon-btn"
        aria-label="Dismiss cache note"
        title="Dismiss"
        onClick={() => setDismissed(note.key)}
      >
        <XIcon />
      </button>
    </div>
  );
}
