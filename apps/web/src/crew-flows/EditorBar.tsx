import './editor-bar.css';
import { useId, type ReactNode } from 'react';
import { WORKFLOW_NAME_MAX } from '@spark-outpost/contracts';
import { BackIcon, CheckIcon, EyeIcon, ShieldIcon } from '../ui/icons.tsx';
import { RunMenu, type RunMenuItem } from './RunMenu.tsx';

interface EditorBarProps {
  name: string;
  summary: string;
  chips: ReactNode;
  previewing: boolean;
  saved: boolean;
  changes: number;
  blocked: string | null;
  busy: boolean;
  canPreview: boolean;
  runItems: readonly RunMenuItem[];
  onName: (name: string) => void;
  onBack: () => void;
  onPreview: () => void;
  onTestRun: () => void;
  onSave: () => void;
}

export function EditorBar(props: EditorBarProps) {
  const nameId = useId();
  const { changes, blocked, busy } = props;
  const dirty = changes > 0;
  return (
    <header className="wf-bar">
      <button type="button" className="btn ghost sm" onClick={props.onBack}>
        <BackIcon />
        {props.previewing ? 'Back to editing' : 'Workflows'}
      </button>
      <label className="sr-only" htmlFor={nameId}>
        Workflow name
      </label>
      <input
        id={nameId}
        className="inp wf-name"
        value={props.name}
        maxLength={WORKFLOW_NAME_MAX}
        placeholder="Workflow name"
        aria-invalid={props.name.trim() === '' || undefined}
        onChange={(event) => props.onName(event.target.value)}
      />
      <span className="wf-tag">{props.summary}</span>
      {props.chips}
      <span className="wf-bar-status" role="status">
        {!dirty && props.saved && (
          <span className="wf-state" data-state="succeeded">
            <CheckIcon className="wf-state-ic" />
            Saved
          </span>
        )}
        {dirty && (
          <span className="wf-unsaved">
            <span className="wf-unsaved-dot" aria-hidden="true" />
            {changes} unsaved {changes === 1 ? 'change' : 'changes'}
          </span>
        )}
      </span>
      <span className="wf-bar-acts">
        {!props.previewing && (
          <button
            type="button"
            className="btn line sm"
            disabled={!props.canPreview}
            onClick={props.onPreview}
          >
            <EyeIcon />
            Preview
          </button>
        )}
        <button
          type="button"
          className="btn line sm"
          disabled={blocked !== null || busy}
          title={blocked ?? undefined}
          onClick={props.onTestRun}
        >
          <ShieldIcon />
          {dirty ? 'Save and test run' : 'Test run'}
        </button>
        <RunMenu items={props.runItems} disabled={blocked !== null || busy} reason={blocked} />
        <button
          type="button"
          className="btn primary sm"
          disabled={blocked !== null || !dirty || busy}
          title={blocked ?? undefined}
          onClick={props.onSave}
        >
          Save
        </button>
      </span>
    </header>
  );
}
