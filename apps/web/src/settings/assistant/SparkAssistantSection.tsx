import { useId } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssistantSettings,
  AssistantSettingsView,
  ProviderSetup,
  SetupState,
} from '@spark-outpost/contracts';
import { assistantApi, assistantKeys } from '../../api/assistant.ts';
import { CAPABILITIES_STALE_MS, capabilitiesQuery } from '../../api/client.ts';
import { effortOptions, modelChoices } from '../../providers/ProviderDefaults.tsx';
import { ChoicePicker, type PickerChoice } from '../../ui/ChoicePicker.tsx';
import { QueryWait } from '../../ui/loading/QueryWait.tsx';
import { Skeleton } from '../../ui/loading/Skeleton.tsx';
import { SettingRow } from '../SettingRow.tsx';
import { AssistantFacts, KEY_FACTS_LABEL } from './AssistantFacts.tsx';
import { AssistantSessionRow, SESSION_LABEL } from './AssistantSessionRow.tsx';
import { effortHint, modelHint } from './assistant-hints.ts';
import './assistant.css';

const PROVIDER = 'Provider';
const MODEL = 'Model';
const EFFORT = 'Effort';

export const ASSISTANT_ROWS = [PROVIDER, MODEL, EFFORT, SESSION_LABEL, KEY_FACTS_LABEL];

const EFFORT_HIDDEN = [EFFORT];

const SAME_PROVIDER = 'same';
const FAST = 'fast';
const SAME_MODEL = 'default';
const DEFAULT_EFFORT = 'default';

const BUSY_POLL_MS = 2_000;

const DOC = { page: 'settings', heading: 'spark-assistant' } as const;

interface SparkAssistantSectionProps {
  setup: SetupState;
  onOpenChat: (conversationId: string) => void;
}

function useAssistantSave() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: assistantApi.save,
    onSuccess: (view) => queryClient.setQueryData(assistantKeys.settings, view),
  });
}

function connectedProviders(setup: SetupState): ProviderSetup[] {
  return setup.providers.filter((provider) => provider.connection !== null);
}

export function SparkAssistantSection({ setup, onOpenChat }: SparkAssistantSectionProps) {
  const view = useQuery({
    queryKey: assistantKeys.settings,
    queryFn: assistantApi.settings,
    refetchInterval: (query) => (query.state.data?.busy ? BUSY_POLL_MS : false),
  });
  return (
    <>
      <p className="lede">
        Ask Spark answers questions about your chats from the island. It keeps one hidden
        conversation and a short list of key facts.
      </p>
      <QueryWait query={view} what="the Spark assistant settings">
        <Skeleton label="Loading the Spark assistant settings" rows={3} />
      </QueryWait>
      {view.data && <AssistantRows view={view.data} setup={setup} onOpenChat={onOpenChat} />}
    </>
  );
}

interface AssistantRowsProps {
  view: AssistantSettingsView;
  setup: SetupState;
  onOpenChat: (conversationId: string) => void;
}

function AssistantRows({ view, setup, onOpenChat }: AssistantRowsProps) {
  const save = useAssistantSave();
  const providerHintId = useId();
  const modelHintId = useId();
  const effortHintId = useId();
  const settings = save.isPending && save.variables ? save.variables : view.settings;
  const connected = connectedProviders(setup);
  const providerId = view.runsOn?.provider ?? settings.provider ?? connected[0]?.id ?? null;
  const provider = connected.find((entry) => entry.id === providerId) ?? null;
  const capabilities = useQuery({
    ...capabilitiesQuery(providerId ?? 'claude'),
    staleTime: CAPABILITIES_STALE_MS,
    enabled: providerId !== null,
  });
  const update = (change: Partial<AssistantSettings>) => save.mutate({ ...settings, ...change });

  const providerChoices: PickerChoice[] = [
    { id: SAME_PROVIDER, label: 'Same as default chat provider' },
    ...connected.map((entry) => ({ id: entry.id, label: entry.name })),
  ];
  const models =
    provider?.connection && capabilities.data
      ? modelChoices(provider.connection, capabilities.data)
      : [];
  const modelValue =
    settings.modelChoice === 'pick' ? (settings.model ?? '') : settings.modelChoice;
  const efforts = provider ? effortOptions(provider, capabilities.data) : [];
  const fastEffort = view.runsOn?.fastEffort ?? null;
  const defaultEffortLabel =
    settings.modelChoice === 'fast' && fastEffort
      ? `Fast default (${efforts.find((entry) => entry.id === fastEffort)?.label ?? fastEffort})`
      : 'Chat default';

  return (
    <>
      <SettingRow
        label={PROVIDER}
        hint="Ask Spark keeps its read-only mode."
        hintId={providerHintId}
        doc={DOC}
      >
        <ChoicePicker
          label="Ask Spark provider"
          choices={providerChoices}
          value={settings.provider ?? SAME_PROVIDER}
          onChange={(id) =>
            update({
              provider: id === SAME_PROVIDER ? null : (id as AssistantSettings['provider']),
              ...(settings.modelChoice === 'pick' ? { modelChoice: 'fast', model: null } : {}),
            })
          }
        />
      </SettingRow>
      <SettingRow
        label={MODEL}
        standsFor={efforts.length > 0 ? undefined : EFFORT_HIDDEN}
        hint={save.error?.message ?? modelHint(view, provider?.name ?? 'This provider')}
        hintId={modelHintId}
      >
        <ChoicePicker
          label="Ask Spark model"
          choices={[
            { id: FAST, label: 'Fast (recommended)' },
            { id: SAME_MODEL, label: 'Same as default chat model' },
            ...models,
          ]}
          value={modelValue}
          onChange={(id) =>
            update(
              id === FAST || id === SAME_MODEL
                ? { modelChoice: id, model: null }
                : { modelChoice: 'pick', model: id },
            )
          }
        />
      </SettingRow>
      {efforts.length > 0 && (
        <SettingRow label={EFFORT} hint={effortHint(view)} hintId={effortHintId}>
          <ChoicePicker
            label="Ask Spark effort"
            choices={[
              { id: DEFAULT_EFFORT, label: defaultEffortLabel },
              ...efforts.map((entry) => ({ id: entry.id, label: entry.label })),
            ]}
            value={settings.effort ?? DEFAULT_EFFORT}
            onChange={(id) => update({ effort: id === DEFAULT_EFFORT ? null : id })}
          />
        </SettingRow>
      )}
      <AssistantSessionRow view={view} onOpenChat={onOpenChat} />
      <AssistantFacts facts={view.facts} />
    </>
  );
}
