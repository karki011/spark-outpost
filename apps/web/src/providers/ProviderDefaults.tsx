import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from '../api/client.ts';
import {
  ACCESS_CHOICES,
  accessChoice,
  accessFor,
  accessHint,
  accessUpdate,
  type CapabilityOption,
  type Choice,
  type ProviderCapabilities,
  type ProviderConnection,
  type ProviderSetup,
  type UpdateProviderDefaultsRequest,
} from '@spark-outpost/contracts';
import { setupApi, setupKey } from '../api/setup.ts';
import {
  cleanDescription,
  effortNote,
  optionLabel,
  selectableEfforts,
} from '../chat/composer/model-options.ts';
import { ChoicePicker } from './ChoicePicker.tsx';

function toChoice(id: string, label: string, description: string): Choice {
  return { id, label, description, risky: false, unavailableReason: null };
}

function accessChoices(provider: ProviderSetup): Choice[] {
  return ACCESS_CHOICES.map((choice) => {
    const permission = provider.permissions.find((option) => option.id === choice.permission);
    return {
      ...toChoice(choice.id, choice.label, accessHint(choice, provider.id)),
      unavailableReason: permission ? permission.unavailableReason : 'Not offered by this agent.',
    };
  });
}

const PER_CHAT = 'per-chat';
const PER_CHAT_NOTE = 'Each chat keeps its own effort, and Do-task Builders follow it.';

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
        <dt>Permissions</dt>
        <dd>
          <ChoicePicker
            label={`${provider.name} permissions`}
            choices={accessChoices(provider)}
            value={accessFor(connection.permission, connection.level)?.id ?? ''}
            onChange={(id) => {
              const choice = accessChoice(id);
              if (choice) mutation.mutate(accessUpdate(choice));
            }}
          />
        </dd>
        <dt>Effort</dt>
        <dd>
          <ChoicePicker
            label={`${provider.name} effort`}
            choices={[
              toChoice(PER_CHAT, 'Per chat', PER_CHAT_NOTE),
              ...efforts.map((choice) =>
                toChoice(choice.id, choice.label, effortNote(choice) ?? ''),
              ),
            ]}
            value={effort?.id ?? PER_CHAT}
            onChange={(id) => mutation.mutate({ effort: id === PER_CHAT ? null : id })}
          />
          {effort && <small className="note">Do-task Builders always use this effort.</small>}
        </dd>
      </dl>
    </section>
  );
}
