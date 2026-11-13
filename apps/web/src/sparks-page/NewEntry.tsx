import { useId, useState, type FormEvent } from 'react';
import { SKILL_DESCRIPTION_MAX, type CrewFileEntry } from '@spark-outpost/contracts';
import {
  newFileProblem,
  newSkillText,
  saveFailure,
  skillDescriptionProblem,
  skillFilePath,
  skillNameProblem,
} from './folder-model.ts';
import { useSaveCrewFile } from './use-crew-files.ts';

interface NewEntryProps {
  sparkId: string;
  files: readonly CrewFileEntry[];
  onCreated: (path: string) => void;
  onCancel: () => void;
}

function useCreate(sparkId: string, onCreated: (path: string) => void) {
  const save = useSaveCrewFile(sparkId);
  const [failed, setFailed] = useState<string | null>(null);
  const create = (path: string, text: string) =>
    save.mutate(
      { path, text, baseHash: null },
      {
        onSuccess: (saved) => onCreated(saved.path),
        onError: (error) => setFailed(saveFailure(error, null).text),
      },
    );
  return { create, failed, pending: save.isPending, clear: () => setFailed(null) };
}

export function NewSkill({ sparkId, files, onCreated, onCancel }: NewEntryProps) {
  const id = useId();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [touched, setTouched] = useState(false);
  const { create, failed, pending, clear } = useCreate(sparkId, onCreated);
  const nameProblem = skillNameProblem(name, files);
  const descriptionProblem = skillDescriptionProblem(description);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    clear();
    if (!nameProblem && !descriptionProblem) {
      create(skillFilePath(name), newSkillText(name, description));
    }
  };
  return (
    <form className="spk-new" aria-labelledby={`${id}-h`} onSubmit={submit} noValidate>
      <h3 id={`${id}-h`}>New skill</h3>
      <p className="spk-hint">
        A skill is a folder with a SKILL.md and any scripts or notes it needs. The Spark reads it
        when the description fits the job.
      </p>
      <label className="field">
        <span>Name</span>
        <input
          className="inp mono"
          autoFocus
          value={name}
          spellCheck={false}
          placeholder="dependency-audit"
          aria-invalid={touched && nameProblem !== null}
          aria-describedby={`${id}-name`}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <p id={`${id}-name`} className="spk-problem" role="alert">
        {touched && nameProblem}
      </p>
      <label className="field">
        <span>Description</span>
        <input
          className="inp"
          value={description}
          maxLength={SKILL_DESCRIPTION_MAX}
          placeholder="Check changed dependencies for known vulnerabilities."
          aria-invalid={touched && descriptionProblem !== null}
          aria-describedby={`${id}-description`}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <p id={`${id}-description`} className="spk-problem" role="alert">
        {touched && descriptionProblem}
        {failed}
      </p>
      <div className="spk-new-acts">
        <button type="button" className="btn ghost sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn primary sm" disabled={pending}>
          Create skill
        </button>
      </div>
    </form>
  );
}

export function NewFile({
  sparkId,
  files,
  startFolder,
  onCreated,
  onCancel,
}: NewEntryProps & { startFolder: string }) {
  const id = useId();
  const [path, setPath] = useState(startFolder);
  const [touched, setTouched] = useState(false);
  const { create, failed, pending, clear } = useCreate(sparkId, onCreated);
  const problem = newFileProblem(path, files);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    clear();
    if (!problem) create(path, '');
  };
  return (
    <form className="spk-new" aria-labelledby={`${id}-h`} onSubmit={submit} noValidate>
      <h3 id={`${id}-h`}>New file</h3>
      <p className="spk-hint">
        A script or notes for this Spark. Give the path inside its folder, such as
        skills/dependency-audit/scripts/audit.sh.
      </p>
      <label className="field">
        <span>Path</span>
        <input
          className="inp mono"
          autoFocus
          value={path}
          spellCheck={false}
          aria-invalid={touched && problem !== null}
          aria-describedby={`${id}-problem`}
          onChange={(event) => setPath(event.target.value)}
        />
      </label>
      <p id={`${id}-problem`} className="spk-problem" role="alert">
        {touched && problem}
        {failed}
      </p>
      <div className="spk-new-acts">
        <button type="button" className="btn ghost sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn primary sm" disabled={pending}>
          Create file
        </button>
      </div>
    </form>
  );
}
