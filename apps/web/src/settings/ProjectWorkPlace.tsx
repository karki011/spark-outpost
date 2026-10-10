import { useId } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_WORK_PLACE,
  workPlaceSchema,
  type Project,
  type WorkPlace,
} from '@spark-outpost/contracts';
import { projectKeys, projectsApi } from '../api/projects.ts';
import { ChoicePicker, type PickerChoice } from '../ui/ChoicePicker.tsx';
import { SettingRow } from './SettingRow.tsx';

const PLACE_LABEL = 'Where Spark works';
const PLACE_HINTS: Record<WorkPlace, string> = {
  worktree: 'Each new chat gets its own branch in a git worktree, so this folder stays as it is.',
  checkout: 'New chats edit the files in this folder directly.',
};

const PLACE_CHOICES: PickerChoice[] = [
  { id: 'worktree', label: 'Each chat in its own worktree (recommended)' },
  { id: 'checkout', label: 'In my files' },
];

function useWorkPlace(project: Project) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (workPlace: WorkPlace) => projectsApi.updateSettings(project.id, { workPlace }),
    onSuccess: (updated) => {
      queryClient.setQueryData<Project[]>(projectKeys.all, (projects) =>
        projects?.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      );
      void queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'conversations' && query.queryKey[2] === 'workspace',
      });
    },
  });
  return {
    place: (save.isPending ? save.variables : project.workPlace) ?? DEFAULT_WORK_PLACE,
    error: save.error?.message ?? null,
    set: (place: WorkPlace) => save.mutate(place),
  };
}

export function ProjectWorkPlace({ project }: { project: Project }) {
  const hintId = useId();
  const settings = useWorkPlace(project);
  return (
    <div className="set-builders" role="group" aria-label={`Work place in ${project.name}`}>
      <SettingRow
        label={PLACE_LABEL}
        doc={{ page: 'where-spark-works' }}
        hint={settings.error ?? PLACE_HINTS[settings.place]}
        hintId={hintId}
      >
        <ChoicePicker
          label={`${PLACE_LABEL} in ${project.name}`}
          choices={PLACE_CHOICES}
          value={settings.place}
          onChange={(id) => settings.set(workPlaceSchema.parse(id))}
        />
      </SettingRow>
    </div>
  );
}
