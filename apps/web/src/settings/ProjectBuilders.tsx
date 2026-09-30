import { useId } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PIECE_SLOTS_MAX, type Project } from '@spark-outpost/contracts';
import { projectKeys, projectsApi, type BuilderSettings } from '../api/projects.ts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import { useTooltip } from '../ui/Tooltip.tsx';
import { SettingRow } from './SettingRow.tsx';

const PARALLEL_LABEL = 'Let Builders work in parallel';
const PARALLEL_HINT =
  'Big plans split into pieces that run at the same time, each in its own worktree.';
const PARALLEL_OFF_TIP =
  'Spark’s server runs pieces one at a time. Start it with COORDINATOR_MODE=parallel to use this.';
const SLOTS_LABEL = 'How many at once';
const STABLE_LABEL = 'Keep this folder untouched';
const STABLE_HINT = 'Builders always work in a separate worktree copy, never in this folder.';

const SLOT_CHOICES = Array.from({ length: PIECE_SLOTS_MAX }, (_, index) => ({
  id: String(index + 1),
  label: `Up to ${index + 1} at once`,
}));

function useBuilderSettings(project: Project) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (change: BuilderSettings) => projectsApi.updateBuilders(project.id, change),
    onSuccess: (updated) =>
      queryClient.setQueryData<Project[]>(projectKeys.all, (projects) =>
        projects?.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      ),
  });
  const pending = save.isPending ? save.variables : {};
  return {
    parallel: pending.parallelPieces ?? project.parallelPieces ?? false,
    slots: pending.pieceSlots ?? project.pieceSlots ?? PIECE_SLOTS_MAX,
    stable: pending.stableCheckout ?? project.stableCheckout ?? false,
    busy: save.isPending,
    error: save.isError ? save.error.message : null,
    set: (change: BuilderSettings) => save.mutate(change),
  };
}

function ParallelToggle({
  project,
  available,
  checked,
  busy,
  hintId,
  onChange,
}: {
  project: Project;
  available: boolean;
  checked: boolean;
  busy: boolean;
  hintId: string;
  onChange: (checked: boolean) => void;
}) {
  const { triggerProps, tooltip } = useTooltip(PARALLEL_OFF_TIP, { side: 'top' });
  const toggle = (
    <BlobToggle
      label={`${PARALLEL_LABEL} in ${project.name}`}
      size="sm"
      checked={available && checked}
      disabled={!available || busy}
      describedBy={hintId}
      onChange={onChange}
    />
  );
  if (available) return toggle;
  return (
    <span className="set-tip-anchor" tabIndex={0} {...triggerProps}>
      {toggle}
      {tooltip}
    </span>
  );
}

export function ProjectBuilders({ project, available }: { project: Project; available: boolean }) {
  const parallelHintId = useId();
  const stableHintId = useId();
  const slotsHintId = useId();
  const settings = useBuilderSettings(project);
  return (
    <div className="set-builders" role="group" aria-label={`Builders in ${project.name}`}>
      <SettingRow
        label={PARALLEL_LABEL}
        hint={settings.error ?? PARALLEL_HINT}
        hintId={parallelHintId}
        disabled={!available}
      >
        <ParallelToggle
          project={project}
          available={available}
          checked={settings.parallel}
          busy={settings.busy}
          hintId={parallelHintId}
          onChange={(parallelPieces) => settings.set({ parallelPieces })}
        />
      </SettingRow>
      {available && settings.parallel && (
        <SettingRow
          label={SLOTS_LABEL}
          hint="More at once finishes sooner and spends faster."
          hintId={slotsHintId}
        >
          <ChoicePicker
            label={`${SLOTS_LABEL} in ${project.name}`}
            choices={SLOT_CHOICES}
            value={String(settings.slots)}
            onChange={(id) => settings.set({ pieceSlots: Number(id) })}
          />
        </SettingRow>
      )}
      <SettingRow label={STABLE_LABEL} hint={STABLE_HINT} hintId={stableHintId}>
        <BlobToggle
          label={`${STABLE_LABEL}: ${project.name}`}
          size="sm"
          checked={settings.stable}
          disabled={settings.busy}
          describedBy={stableHintId}
          onChange={(stableCheckout) => settings.set({ stableCheckout })}
        />
      </SettingRow>
    </div>
  );
}
