import './test-run.css';
import { useId, useState, type FormEvent } from 'react';
import { useProjects } from '../chat/project/use-chat-repos.ts';
import { useAddFolder } from '../projects/use-add-folder.tsx';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import { WarnIcon } from '../ui/icons.tsx';

const NO_PROJECT = '';
const MESSAGE_MAX = 4000;

interface RunStartProps {
  name: string;
  starting: boolean;
  error: string | null;
  onStart: (start: { projectId: string | null; message: string }) => void;
  onCancel: () => void;
}

export function RunStart({ name, starting, error, onStart, onCancel }: RunStartProps) {
  const messageId = useId();
  const [projectId, setProjectId] = useState(NO_PROJECT);
  const [message, setMessage] = useState('');
  const projects = useProjects();
  const adder = useAddFolder({ onAdded: (project) => setProjectId(project.id) });
  const choices = [
    { id: NO_PROJECT, label: 'No project', description: 'Steps work from text alone.' },
    ...(projects.data ?? []).map((project) => ({
      id: project.id,
      label: project.name,
      description: project.displayPath,
    })),
  ];
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!starting) onStart({ projectId: projectId || null, message: message.trim() });
  };
  return (
    <form className="wf-test-start" onSubmit={submit} aria-label={`Run ${name}`}>
      <h3>Run {name}</h3>
      <p className="wf-hint">
        The run starts in a new chat named for the workflow, in the project you pick.
      </p>
      <div className="field">
        <span>Project</span>
        <ChoicePicker
          label="Project"
          choices={choices}
          value={projectId}
          actions={adder.actions}
          onChange={setProjectId}
        />
        {adder.flow}
      </div>
      <div className="field">
        <label htmlFor={messageId}>What this run is about</label>
        <textarea
          id={messageId}
          className="inp wf-test-message"
          rows={3}
          maxLength={MESSAGE_MAX}
          placeholder="Review the last commit."
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
      </div>
      {error && (
        <p className="wf-problem" role="alert">
          <WarnIcon />
          <span>
            <b>Couldn’t start</b> · {error}
          </span>
        </p>
      )}
      <div className="wf-test-acts">
        <button type="button" className="btn line sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn primary sm" disabled={starting}>
          {starting ? 'Starting…' : 'Run'}
        </button>
      </div>
    </form>
  );
}
