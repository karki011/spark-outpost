import { useQuery } from '@tanstack/react-query';
import {
  AUTONOMY_LEVELS,
  type InvolvementLevel,
  type ProviderId,
  type ProviderSetup,
} from '@spark-outpost/contracts';
import { CAPABILITIES_STALE_MS, capabilitiesQuery } from '../api/client.ts';
import { effortOptions, modeChoices, modelChoices } from '../providers/ProviderDefaults.tsx';
import { ChoicePicker, type PickerChoice } from '../ui/ChoicePicker.tsx';
import { InfoTip } from '../ui/InfoTip.tsx';

const DEFAULT = '';

export interface DefaultsDraft {
  provider: ProviderId | null;
  model: string | null;
  effort: string | null;
  agentMode: string | null;
  level: InvolvementLevel | null;
}

interface TeammateDefaultsProps {
  draft: DefaultsDraft;
  providers: readonly ProviderSetup[];
  onChange: (next: DefaultsDraft) => void;
}

const LEVEL_CHOICES: PickerChoice[] = [
  { id: DEFAULT, label: 'Spark default', description: 'Follows Settings → Chats & autonomy.' },
  ...AUTONOMY_LEVELS.map((level) => ({
    id: level.id,
    label: level.label,
    description: level.hint,
  })),
];

function withDefault(label: string, choices: readonly PickerChoice[]): PickerChoice[] {
  return [{ id: DEFAULT, label }, ...choices];
}

function ProviderModels({
  draft,
  provider,
  onChange,
}: {
  draft: DefaultsDraft;
  provider: ProviderSetup;
  onChange: (next: DefaultsDraft) => void;
}) {
  const capabilities = useQuery({
    ...capabilitiesQuery(provider.id),
    staleTime: CAPABILITIES_STALE_MS,
    enabled: provider.connection?.method === 'cli',
  });
  const models = provider.connection ? modelChoices(provider.connection, capabilities.data) : [];
  const modes = modeChoices(capabilities.data, draft.agentMode);
  const efforts = effortOptions(provider, capabilities.data).map(({ id, label, description }) => ({
    id,
    label,
    ...(description ? { description } : {}),
  }));
  return (
    <>
      <div className="field">
        <span>Model</span>
        <ChoicePicker
          label="Model"
          choices={withDefault(`${provider.name} default`, models)}
          value={draft.model ?? DEFAULT}
          onChange={(id) => onChange({ ...draft, model: id || null })}
        />
      </div>
      {efforts.length > 0 && (
        <div className="field">
          <span>Effort</span>
          <ChoicePicker
            label="Effort"
            choices={withDefault(`${provider.name} default`, efforts)}
            value={draft.effort ?? DEFAULT}
            onChange={(id) => onChange({ ...draft, effort: id || null })}
          />
        </div>
      )}
      <div className="field">
        <span>Mode</span>
        <ChoicePicker
          label="Mode"
          choices={withDefault(`${provider.name} default`, modes)}
          value={draft.agentMode ?? DEFAULT}
          onChange={(id) => onChange({ ...draft, agentMode: id || null })}
        />
      </div>
    </>
  );
}

export function TeammateDefaults({ draft, providers, onChange }: TeammateDefaultsProps) {
  const connected = providers.filter((provider) => provider.connection);
  const provider = connected.find((entry) => entry.id === draft.provider) ?? null;
  return (
    <div className="tm-defaults">
      <div className="field">
        <span>Provider</span>
        <ChoicePicker
          label="Provider"
          choices={withDefault(
            'Default provider',
            connected.map((entry) => ({ id: entry.id, label: entry.name })),
          )}
          value={draft.provider ?? DEFAULT}
          onChange={(id) =>
            onChange({
              ...draft,
              provider: connected.find((entry) => entry.id === id)?.id ?? null,
              model: null,
              effort: null,
              agentMode: null,
            })
          }
        />
      </div>
      {provider && <ProviderModels draft={draft} provider={provider} onChange={onChange} />}
      <div className="field">
        <span>
          Spark autonomy{' '}
          <InfoTip
            topic="Spark autonomy"
            text="What happens to the result of this Spark's chats. Spark default follows Settings → Chats & autonomy."
          />
        </span>
        <ChoicePicker
          label="Spark autonomy"
          choices={LEVEL_CHOICES}
          showNote={false}
          value={draft.level ?? DEFAULT}
          onChange={(id) =>
            onChange({
              ...draft,
              level: AUTONOMY_LEVELS.find((level) => level.id === id)?.id ?? null,
            })
          }
        />
      </div>
    </div>
  );
}
