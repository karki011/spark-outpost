import { useId } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  MeetingModelSettings,
  MeetingModelView,
  ProviderSetup,
} from '@spark-outpost/contracts';
import { CAPABILITIES_STALE_MS, capabilitiesQuery } from '../api/client.ts';
import { setupApi, setupKey } from '../api/setup.ts';
import { effortOptions, modelChoices } from '../providers/ProviderDefaults.tsx';
import { SettingRow } from '../settings/SettingRow.tsx';
import { ChoicePicker, type PickerChoice } from '../ui/ChoicePicker.tsx';
import { meetingKeys } from './meeting-keys.ts';
import { meetingsApi } from './meetings-api.ts';
import { useMeetingStatus } from './use-meetings.ts';

const PROVIDER = 'Meeting provider';
const MODEL = 'Meeting model';
const EFFORT = 'Meeting effort';

export const MEETING_MODEL_ROWS = [PROVIDER, MODEL, EFFORT];

const EFFORT_HIDDEN = [EFFORT];
const SAME_PROVIDER = 'same';
const FAST = 'fast';
const DEFAULT_EFFORT = 'default';

const DOC = { page: 'meetings', heading: 'choose-the-model' } as const;

export function modelHint(view: MeetingModelView): string {
  if (!view.runsOn) return 'Connect a provider first.';
  const label = view.runsOn.modelLabel ?? 'the provider’s default model';
  return view.settings.model
    ? `Notes are written with ${label}, and a new meeting’s questions start on it.`
    : `Notes are written with ${label}. A new meeting’s questions start on the provider’s chat model.`;
}

export function MeetingModelSetting() {
  const status = useMeetingStatus();
  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get });
  const view = useQuery({
    queryKey: meetingKeys.model,
    queryFn: meetingsApi.model,
    enabled: status.data?.supported === true,
  });
  if (!status.data?.supported || !view.data || !setup.data) return null;
  const connected = setup.data.providers.filter((provider) => provider.connection !== null);
  return (
    <section className="spark-group" aria-labelledby="notify-meeting-model">
      <h4 id="notify-meeting-model">Meeting notes and questions</h4>
      <MeetingModelRows view={view.data} connected={connected} />
    </section>
  );
}

interface MeetingModelRowsProps {
  view: MeetingModelView;
  connected: ProviderSetup[];
}

function MeetingModelRows({ view, connected }: MeetingModelRowsProps) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: meetingsApi.saveModel,
    onSuccess: (saved) => queryClient.setQueryData(meetingKeys.model, saved),
  });
  const providerHintId = useId();
  const modelHintId = useId();
  const effortHintId = useId();
  const settings = save.isPending && save.variables ? save.variables : view.settings;
  const providerId = view.runsOn?.provider ?? null;
  const provider = connected.find((entry) => entry.id === providerId) ?? null;
  const capabilities = useQuery({
    ...capabilitiesQuery(providerId ?? 'claude'),
    staleTime: CAPABILITIES_STALE_MS,
    enabled: providerId !== null,
  });
  const update = (change: Partial<MeetingModelSettings>) => save.mutate({ ...settings, ...change });

  const providerChoices: PickerChoice[] = [
    { id: SAME_PROVIDER, label: 'Same as default chat provider' },
    ...connected.map((entry) => ({ id: entry.id, label: entry.name })),
  ];
  const models =
    provider?.connection && capabilities.data
      ? modelChoices(provider.connection, capabilities.data)
      : [];
  const efforts = provider ? effortOptions(provider, capabilities.data) : [];

  return (
    <>
      <SettingRow
        label={PROVIDER}
        hint="Writes a meeting’s notes and title, and answers a new meeting’s questions."
        hintId={providerHintId}
        doc={DOC}
      >
        <ChoicePicker
          label={PROVIDER}
          choices={providerChoices}
          value={settings.provider ?? SAME_PROVIDER}
          onChange={(id) =>
            update({
              provider: id === SAME_PROVIDER ? null : (id as MeetingModelSettings['provider']),
              model: null,
              effort: null,
            })
          }
        />
      </SettingRow>
      <SettingRow
        label={MODEL}
        standsFor={efforts.length > 0 ? undefined : EFFORT_HIDDEN}
        hint={save.error?.message ?? modelHint(view)}
        hintId={modelHintId}
      >
        <ChoicePicker
          label={MODEL}
          choices={[{ id: FAST, label: 'Fast (recommended)' }, ...models]}
          value={settings.model ?? FAST}
          onChange={(id) => update({ model: id === FAST ? null : id })}
        />
      </SettingRow>
      {efforts.length > 0 && (
        <SettingRow
          label={EFFORT}
          hint={
            view.runsOn?.effort
              ? `Notes are written at ${view.runsOn.effort} effort.`
              : 'Notes use the provider’s default effort.'
          }
          hintId={effortHintId}
        >
          <ChoicePicker
            label={EFFORT}
            choices={[
              { id: DEFAULT_EFFORT, label: 'Default' },
              ...efforts.map((entry) => ({ id: entry.id, label: entry.label })),
            ]}
            value={settings.effort ?? DEFAULT_EFFORT}
            onChange={(id) => update({ effort: id === DEFAULT_EFFORT ? null : id })}
          />
        </SettingRow>
      )}
    </>
  );
}
