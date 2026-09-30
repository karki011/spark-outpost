import { useId } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_WORK_PLACE,
  PIECE_SLOTS_MAX,
  workPlaceSchema,
  type Project,
  type WorkPlace,
} from '@spark-outpost/contracts';
import { projectKeys, projectsApi, type BuilderSettings } from '../api/projects.ts';
import { ChoicePicker, type PickerChoice } from '../ui/ChoicePicker.tsx';
import { SettingRow } from './SettingRow.tsx';

const SLOTS_LABEL = 'Builders at once';
const SLOTS_HINT =
  'Big plans split into pieces that run at the same time. More at once finishes sooner and spends faster.';
const IN_ORDER_HINT = 'Pieces of a big plan run one after another.';
const SERVER_IN_ORDER =
  'Spark’s server is set to run pieces one at a time (COORDINATOR_MODE), so Builders work in order.';
const PLACE_LABEL = 'Where Spark works';
const PLACE_HINTS: Record<WorkPlace, string> = {
  worktree: 'Each new chat gets its own branch in a git worktree, so this folder stays as it is.',
  checkout: 'New chats edit the files in this folder directly.',
};

const PLACE_CHOICES: PickerChoice[] = [
  { id: 'worktree', label: 'Each chat in its own worktree (recommended)' },
  { id: 'checkout', label: 'In my files' },
];

function slotChoices(available: boolean): PickerChoice[] {
  return Array.from({ length: PIECE_SLOTS_MAX }, (_, index) => {
    const slots = index + 1;
    return {
      id: String(slots),
      label: slots === 1 ? '1 at a time, in order' : `Up to ${slots} at once`,
      unavailableReason: available || slots === 1 ? null : SERVER_IN_ORDER,
    };
  });
}

function useBuilderSettings(project: Project) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (change: BuilderSettings) => projectsApi.updateBuilders(project.id, change),
    onSuccess: (updated, change) => {
      queryClient.setQueryData<Project[]>(projectKeys.all, (projects) =>
        projects?.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      );
      if (change.workPlace) {
        void queryClient.invalidateQueries({
          predicate: (query) =>
            query.queryKey[0] === 'conversations' && query.queryKey[2] === 'workspace',
        });
      }
    },
  });
  const pending = save.isPending ? save.variables : {};
  const failed = save.isError ? save.variables : {};
  const message = save.error?.message ?? null;
  return {
    slots: pending.pieceSlots ?? project.pieceSlots ?? PIECE_SLOTS_MAX,
    place: pending.workPlace ?? project.workPlace ?? DEFAULT_WORK_PLACE,
    slotsError: failed.pieceSlots === undefined ? null : message,
    placeError: failed.workPlace === undefined ? null : message,
    set: (change: BuilderSettings) => save.mutate(change),
  };
}

export function ProjectBuilders({ project, available }: { project: Project; available: boolean }) {
  const slotsHintId = useId();
  const placeHintId = useId();
  const settings = useBuilderSettings(project);
  const slots = available ? settings.slots : 1;
  const slotsHint = available ? (slots === 1 ? IN_ORDER_HINT : SLOTS_HINT) : SERVER_IN_ORDER;
  return (
    <div className="set-builders" role="group" aria-label={`Builders in ${project.name}`}>
      <SettingRow label={SLOTS_LABEL} hint={settings.slotsError ?? slotsHint} hintId={slotsHintId}>
        <ChoicePicker
          label={`${SLOTS_LABEL} in ${project.name}`}
          choices={slotChoices(available)}
          value={String(slots)}
          onChange={(id) => {
            if (available) settings.set({ pieceSlots: Number(id) });
          }}
        />
      </SettingRow>
      <SettingRow
        label={PLACE_LABEL}
        hint={settings.placeError ?? PLACE_HINTS[settings.place]}
        hintId={placeHintId}
      >
        <ChoicePicker
          label={`${PLACE_LABEL} in ${project.name}`}
          choices={PLACE_CHOICES}
          value={settings.place}
          onChange={(id) => settings.set({ workPlace: workPlaceSchema.parse(id) })}
        />
      </SettingRow>
    </div>
  );
}
