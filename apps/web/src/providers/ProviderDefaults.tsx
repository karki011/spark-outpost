import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from '../api/client.ts';
import {
  INVOLVEMENT_LEVELS,
  levelHint,
  type CapabilityOption,
  type Choice,
  type ProviderCapabilities,
  type ProviderConnection,
  type ProviderSetup,
  type UpdateProviderDefaultsRequest,
} from '@spark-outpost/contracts';
import { setupApi, setupKey } from '../api/setup.ts';
import { Segmented } from '../ui/Segmented.tsx';
import {
  cleanDescription,
  effortNote,
  optionLabel,
  selectableEfforts,
} from '../chat/composer/model-options.ts';
import { ChoicePicker } from './ChoicePicker.tsx';

function levelChoices(provider: string): Choice[] {
  return INVOLVEMENT_LEVELS.map((level) => ({
    id: level.id,
    label: level.label,
    description: levelHint(level, provider),
    risky: false,
    unavailableReason: null,
  }));
}

const PER_CHAT = 'per-chat';

function effortOptions(
  provider: ProviderSetup,
  capabilities: ProviderCapabilities | undefined,
): CapabilityOption[] {
  const reported = selectableEfforts(capabilities);
  if (reported.length > 0) return reported;
  return provider.efforts.map(({ id, label, description }) => ({ id, label, description }));
}

interface ProviderDefaultsProps {
  provider: ProviderSetup;
  connection: ProviderConnection;
}

export function ProviderDefaults({ provider, connection }: ProviderDefaultsProps) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (update: UpdateProviderDefaultsRequest) =>
      setupApi.updateDefaults(provider.id, update),
    onSuccess: (state, update) => {
      queryClient.setQueryData(setupKey, state);
      if (update.effort !== undefined) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
      }
    },
  });
  const capabilities = useQuery({
    queryKey: queryKeys.capabilities(provider.id),
    queryFn: () => api.getCapabilities(provider.id),
    staleTime: 60 * 60 * 1000,
    enabled: connection.method === 'cli',
  });
  const models =
    connection.method === 'cli' && capabilities.data
      ? capabilities.data.models.map((model) => ({
          id: model.id,
          label: optionLabel(model, capabilities.data),
          description: cleanDescription(model) ?? '',
          risky: false,
          unavailableReason: null,
        }))
      : connection.models.map((model) => ({
          ...model,
          description: '',
          risky: false,
          unavailableReason: null,
        }));
  const efforts = effortOptions(provider, capabilities.data);
  const effort = efforts.find((choice) => choice.id === connection.effort) ?? null;
  const offered = models.some((model) => model.id === connection.model);
  const selectedModel = offered ? connection.model : (capabilities.data?.defaultModel ?? null);

  return (
    <section className="conn-section" aria-labelledby={`${provider.id}-defaults-title`}>
      <h4 className="conn-section-title" id={`${provider.id}-defaults-title`}>
        Defaults for new chats
      </h4>
      <dl className="conn-details">
        <dt>Model</dt>
        <dd>
          {models.length === 0 ? (
            <span className="muted">
              {capabilities.isFetching
                ? `Asking ${provider.name} for its models…`
                : `Whatever your ${provider.cli} CLI is set to`}
            </span>
          ) : (
            <ChoicePicker
              label={`${provider.name} model`}
              choices={models}
              value={selectedModel ?? ''}
              onChange={(id) => mutation.mutate({ model: id })}
            />
          )}
        </dd>
        <dt>Permission</dt>
        <dd>
          <ChoicePicker
            label={`${provider.name} permission`}
            choices={provider.permissions}
            value={connection.permission}
            onChange={(id) => mutation.mutate({ permission: id })}
          />
        </dd>
        <dt>Involvement</dt>
        <dd>
          <ChoicePicker
            label={`${provider.name} involvement level`}
            choices={levelChoices(provider.id)}
            value={connection.level}
            onChange={(id) => {
              const level = INVOLVEMENT_LEVELS.find((option) => option.id === id);
              if (level) mutation.mutate({ level: level.id });
            }}
          />
        </dd>
        <dt>Effort</dt>
        <dd>
          <Segmented
            ariaLabel={`${provider.name} effort`}
            options={[
              { id: PER_CHAT, label: 'Per chat' },
              ...efforts.map((choice) => ({ id: choice.id, label: choice.label })),
            ]}
            value={effort?.id ?? PER_CHAT}
            onChange={(id) => mutation.mutate({ effort: id === PER_CHAT ? null : id })}
          />
          <small className="note">
            {effort
              ? `${effortNote(effort) ?? effort.label}. Do-task Builders always use it.`
              : 'Each chat keeps its own effort, and Do-task Builders follow it.'}
          </small>
        </dd>
      </dl>
    </section>
  );
}
