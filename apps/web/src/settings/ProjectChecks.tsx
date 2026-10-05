import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CHECK_COMMANDS_MAX,
  CHECK_COMMAND_MAX_LENGTH,
  type Project,
} from '@spark-outpost/contracts';
import { projectKeys, projectsApi } from '../api/projects.ts';
import { ChoicePicker, type PickerChoice } from '../ui/ChoicePicker.tsx';
import { SettingRow } from './SettingRow.tsx';

const LABEL = 'Checks after a change';

type Mode = 'auto' | 'own' | 'off';

const CHOICES: PickerChoice[] = [
  { id: 'auto', label: 'Found automatically' },
  { id: 'own', label: 'My commands' },
  { id: 'off', label: 'Off' },
];

const HINTS: Record<Mode, string> = {
  auto: 'Spark runs the project’s typecheck, lint and test scripts, narrowed to what the change touched when it can.',
  own: `Spark runs exactly these commands, one per line, up to ${CHECK_COMMANDS_MAX}.`,
  off: 'Spark runs no checks after a change in this project.',
};

function modeOf(commands: readonly string[] | null | undefined): Mode {
  if (!commands) return 'auto';
  return commands.length === 0 ? 'off' : 'own';
}

export function commandsFrom(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

function problemWith(commands: readonly string[]): string | null {
  if (commands.length === 0) return 'Add at least one command, or choose Off.';
  if (commands.length > CHECK_COMMANDS_MAX) return `Keep it to ${CHECK_COMMANDS_MAX} commands.`;
  if (commands.some((command) => command.length > CHECK_COMMAND_MAX_LENGTH)) {
    return `Each command can be up to ${CHECK_COMMAND_MAX_LENGTH} characters.`;
  }
  return null;
}

export function ProjectChecks({ project }: { project: Project }) {
  const hintId = useId();
  const fieldId = useId();
  const queryClient = useQueryClient();
  const saved = project.checkCommands ?? null;
  const [mode, setMode] = useState<Mode>(modeOf(saved));
  const [draft, setDraft] = useState((saved ?? []).join('\n'));
  const save = useMutation({
    mutationFn: (checkCommands: string[] | null) =>
      projectsApi.updateBuilders(project.id, { checkCommands }),
    onSuccess: (updated) => {
      queryClient.setQueryData<Project[]>(projectKeys.all, (projects) =>
        projects?.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      );
    },
  });
  const commands = commandsFrom(draft);
  const problem = mode === 'own' ? problemWith(commands) : null;
  const unsaved = mode === 'own' && commands.join('\n') !== (saved ?? []).join('\n');
  const choose = (next: Mode) => {
    setMode(next);
    if (next === 'auto') save.mutate(null);
    if (next === 'off') save.mutate([]);
  };
  return (
    <div className="set-builders" role="group" aria-label={`Checks in ${project.name}`}>
      <SettingRow
        label={LABEL}
        doc={{ page: 'review-changes', heading: 'checks-after-a-change' }}
        hint={save.error?.message ?? HINTS[mode]}
        hintId={hintId}
      >
        <ChoicePicker
          label={`${LABEL} in ${project.name}`}
          choices={CHOICES}
          value={mode}
          onChange={(id) => {
            if (id === 'auto' || id === 'own' || id === 'off') choose(id);
          }}
        />
      </SettingRow>
      {mode === 'own' && (
        <form
          className="set-checks"
          onSubmit={(event) => {
            event.preventDefault();
            if (!problem) save.mutate(commands);
          }}
        >
          <div className="field">
            <label htmlFor={fieldId}>Check commands for {project.name}</label>
            <textarea
              id={fieldId}
              className="inp mono"
              rows={3}
              value={draft}
              placeholder={'pnpm exec nx affected -t test\npnpm run lint'}
              aria-describedby={hintId}
              onChange={(event) => setDraft(event.target.value)}
            />
          </div>
          {problem && unsaved && (
            <p className="set-hint" role="alert">
              {problem}
            </p>
          )}
          <button
            type="submit"
            className="btn primary sm"
            disabled={!unsaved || problem !== null || save.isPending}
          >
            Save commands
          </button>
        </form>
      )}
    </div>
  );
}
