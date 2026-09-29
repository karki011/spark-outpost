import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CAPABILITIES_STALE_MS, capabilitiesQuery, queryKeys } from '../api/client.ts';
import {
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
import { withCurrentMode } from '../chat/composer/mode-summary.ts';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';

function toChoice(id: string, label: string, description: string): Choice {
  return { id, label, description, risky: false, unavailableReason: null };
}

function modeChoices(capabilities: ProviderCapabilities | undefined, current: string | null) {
  const modes = withCurrentMode(capabilities?.modes ?? [], current);
  return modes.map((mode) =>
    toChoice(
      mode.id,
      mode.id === capabilities?.defaultMode ? `${mode.label} (default)` : mode.label,
      mode.description ?? '',
    ),
  );
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
    ...capabilitiesQuery(provider.id),
    staleTime: CAPABILITIES_STALE_MS,
  });
  const cli = connection.method === 'cli';
  const models =
    cli && capabilities.data
      ? capabilities.data.models.map((model) =>
          toChoice(model.id, optionLabel(model, capabilities.data), cleanDescription(model) ?? ''),
        )
      : connection.models.map((model) => toChoice(model.id, model.label, ''));
  const efforts = effortOptions(provider, capabilities.data);
  const effort = efforts.find((choice) => choice.id === connection.effort) ?? null;
  const offered = models.some((model) => model.id === connection.model);
  const selectedModel = offered ? connection.model : (capabilities.data?.defaultModel ?? null);
  const agentMode = connection.agentMode ?? capabilities.data?.defaultMode ?? null;
  const modes = modeChoices(capabilities.data, agentMode);

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
        <dt>Default mode for new chats</dt>
        <dd>
          {modes.length === 0 ? (
            <span className="muted">
              {capabilities.isFetching
                ? `Asking ${provider.name} for its modes…`
                : `Whatever your ${provider.cli} CLI is set to`}
            </span>
          ) : (
            <ChoicePicker
              label={`${provider.name} default mode`}
              choices={modes}
              value={agentMode ?? ''}
              onChange={(id) => mutation.mutate({ agentMode: id })}
            />
          )}
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
