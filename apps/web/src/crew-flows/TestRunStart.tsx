import { useId, useState, type FormEvent } from 'react';
import { TEST_RUN_LIMITS } from '@spark-outpost/contracts';
import { useProjects } from '../chat/project/use-chat-repos.ts';
import { useAddFolder } from '../projects/use-add-folder.tsx';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import { WarnIcon } from '../ui/icons.tsx';
import type { TestRunStart as Start } from './test-run-api.ts';

const NO_PROJECT = '';

interface TestRunStartProps {
  title: string;
  hint: string;
  placeholder: string;
  submitLabel: string;
  defaultProjectId: string | null;
  starting: boolean;
  error: string | null;
  onStart: (start: Start) => void;
  onCancel?: () => void;
}

export function TestRunStart(props: TestRunStartProps) {
  const messageId = useId();
  const [projectId, setProjectId] = useState(props.defaultProjectId ?? NO_PROJECT);
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
    if (!props.starting) props.onStart({ projectId: projectId || null, message: message.trim() });
  };
  return (
    <form className="wf-test-start" onSubmit={submit} aria-label={props.title}>
      <h3>{props.title}</h3>
      <p className="wf-hint">{props.hint}</p>
      <div className="field">
        <span>Project to copy</span>
        <ChoicePicker
          label="Project to copy"
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
          maxLength={4000}
          placeholder={props.placeholder}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
      </div>
      <p className="wf-hint">The copy is made from the project’s last commit. {TEST_RUN_LIMITS}</p>
      {props.error && (
        <p className="wf-problem" role="alert">
          <WarnIcon />
          <span>
            <b>Couldn’t start</b> · {props.error}
          </span>
        </p>
      )}
      <div className="wf-test-acts">
        {props.onCancel && (
          <button type="button" className="btn line sm" onClick={props.onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn primary sm" disabled={props.starting}>
          {props.starting ? 'Making the copy…' : props.submitLabel}
        </button>
      </div>
    </form>
  );
}
