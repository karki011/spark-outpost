import './project-preview.css';
import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  previewConfigSchema,
  type PreviewConfig,
  type PreviewSuggestion,
  type Project,
} from '@spark-outpost/contracts';
import { previewApi, previewKeys } from '../api/preview.ts';
import { projectKeys } from '../api/projects.ts';
import { SettingRow } from './SettingRow.tsx';

const LABEL = 'Preview';
const UNSET_HINT =
  'Not set. Save the command that starts your dev server, and Spark runs it for the Browser pane and for agents.';

type Field = 'command' | 'url' | 'folder' | 'readyUrl';

interface Draft {
  command: string;
  url: string;
  folder: string;
  readyUrl: string;
}

const FIELDS: readonly { field: Field; label: string; placeholder: string; optional: boolean }[] = [
  { field: 'command', label: 'Dev server command', placeholder: 'pnpm dev', optional: false },
  { field: 'url', label: 'Address', placeholder: 'http://localhost:5173', optional: false },
  { field: 'folder', label: 'Working folder', placeholder: 'apps/web', optional: true },
  {
    field: 'readyUrl',
    label: 'Ready when this address answers',
    placeholder: 'Same as the address',
    optional: true,
  },
];

function draftOf(preview: PreviewConfig | null): Draft {
  return {
    command: preview?.command ?? '',
    url: preview?.url ?? '',
    folder: preview?.folder ?? '',
    readyUrl: preview?.readyUrl ?? '',
  };
}

function summary(preview: PreviewConfig): string {
  const where = preview.folder ? ` in ${preview.folder}` : '';
  return `Spark runs ${preview.command}${where} and opens ${preview.url}.`;
}

function checked(draft: Draft) {
  const parsed = previewConfigSchema.safeParse(draft);
  if (parsed.success) return { config: parsed.data, errors: {} as Partial<Record<Field, string>> };
  const errors: Partial<Record<Field, string>> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as Field;
    errors[field] ??=
      field === 'url' && draft.url.trim() === '' ? 'Type the address.' : issue.message;
  }
  return { config: null, errors };
}

function Suggestions({
  suggestions,
  onUse,
}: {
  suggestions: readonly PreviewSuggestion[];
  onUse: (config: PreviewConfig) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className="pv-suggest" role="group" aria-label="Suggestions">
      <span className="set-hint">Found in this project</span>
      {suggestions.map((suggestion) => (
        <button
          key={`${suggestion.source}:${suggestion.label}`}
          type="button"
          className="btn line sm pv-suggestion"
          title={suggestion.label}
          onClick={() => onUse(suggestion.config)}
        >
          <code>{suggestion.config.command}</code>
          <span>{suggestion.config.url}</span>
          <small>{suggestion.label}</small>
        </button>
      ))}
    </div>
  );
}

interface FormProps {
  project: Project;
  onDone: () => void;
}

function PreviewForm({ project, onDone }: FormProps) {
  const ids = useId();
  const queryClient = useQueryClient();
  const saved = project.preview ?? null;
  const [draft, setDraft] = useState(() => draftOf(saved));
  const [submitted, setSubmitted] = useState(false);
  const found = useQuery({
    queryKey: previewKeys.project(project.id),
    queryFn: () => previewApi.project(project.id),
  });
  const save = useMutation({
    mutationFn: (preview: PreviewConfig | null) => previewApi.save(project.id, preview),
    onSuccess: (updated) => {
      queryClient.setQueryData<Project[]>(projectKeys.all, (projects) =>
        projects?.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      );
      void queryClient.invalidateQueries({ queryKey: previewKeys.all });
      onDone();
    },
  });
  const { config, errors } = checked(draft);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (config) save.mutate(config);
  };

  return (
    <form
      className="pv-form"
      aria-label={`Preview of ${project.name}`}
      noValidate
      onSubmit={submit}
    >
      <Suggestions
        suggestions={found.data?.suggestions ?? []}
        onUse={(suggested) => setDraft(draftOf(suggested))}
      />
      {FIELDS.map(({ field, label, placeholder, optional }) => {
        const error = submitted ? errors[field] : undefined;
        return (
          <div className="field" key={field}>
            <label htmlFor={`${ids}-${field}`}>
              {label}
              {optional && <small> (optional)</small>}
            </label>
            <input
              id={`${ids}-${field}`}
              className="inp mono"
              value={draft[field]}
              placeholder={placeholder}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${ids}-${field}-error` : undefined}
              onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
            />
            {error && (
              <small className="pv-error" id={`${ids}-${field}-error`}>
                {error}
              </small>
            )}
          </div>
        );
      })}
      <p className="set-hint">
        Spark runs the command in a terminal of its own, sets PORT to the port it uses, and stops it
        when you quit. Only you can change it here; agents cannot.
      </p>
      {save.error && (
        <p className="set-hint" role="alert">
          {save.error.message}
        </p>
      )}
      <div className="pv-foot">
        {saved && (
          <button
            type="button"
            className="btn ghost sm danger pv-remove"
            disabled={save.isPending}
            onClick={() => save.mutate(null)}
          >
            Remove preview
          </button>
        )}
        <button type="button" className="btn line sm" disabled={save.isPending} onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn primary sm" disabled={save.isPending}>
          Save preview
        </button>
      </div>
    </form>
  );
}

export function ProjectPreview({ project }: { project: Project }) {
  const hintId = useId();
  const [editing, setEditing] = useState(false);
  const saved = project.preview ?? null;
  return (
    <div className="set-builders" role="group" aria-label={`Preview in ${project.name}`}>
      <SettingRow
        label={LABEL}
        doc={{ page: 'use-the-browser', heading: 'let-spark-run-your-dev-server' }}
        hint={saved ? summary(saved) : UNSET_HINT}
        hintId={hintId}
      >
        <button
          type="button"
          className="btn line sm"
          aria-expanded={editing}
          aria-label={`${saved ? 'Edit' : 'Set up'} the preview of ${project.name}`}
          aria-describedby={hintId}
          onClick={() => setEditing(!editing)}
        >
          {saved ? 'Edit' : 'Set up'}
        </button>
      </SettingRow>
      {editing && <PreviewForm project={project} onDone={() => setEditing(false)} />}
    </div>
  );
}
