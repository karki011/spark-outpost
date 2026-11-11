import { useId, useState } from 'react';
import { isSparkNote, type SubagentRow } from '@spark-outpost/contracts';
import { Markdown } from '../markdown/Markdown.tsx';
import { StepIcon, StepName } from '../WorkLog.tsx';
import { fileLabel } from './subagent-view.ts';

interface SubagentDetailProps {
  id: string;
  row: SubagentRow;
  task: string | null;
  live: boolean;
}

const LONG_BRIEF_CHARACTERS = 400;
const LONG_BRIEF_LINES = 6;

function isLongBrief(task: string): boolean {
  return task.length > LONG_BRIEF_CHARACTERS || task.split('\n').length > LONG_BRIEF_LINES;
}

function Brief({ task }: { task: string }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const long = isLongBrief(task);
  return (
    <section className="sa-section" aria-label="Brief">
      <b className="sa-heading">Brief</b>
      <div id={bodyId} className={long && !open ? 'sa-brief clamped' : 'sa-brief'}>
        <Markdown text={task} />
      </div>
      {long && (
        <button
          type="button"
          className="sa-more"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Show less' : 'Show the full brief'}
        </button>
      )}
    </section>
  );
}

export function SubagentDetail({ id, row, task, live }: SubagentDetailProps) {
  const said = row.message ?? row.summary ?? null;
  const steps = row.steps.filter((step) => !isSparkNote(step.name));
  return (
    <div id={id} className="sa-detail">
      {task && <Brief task={task} />}
      {steps.length > 0 && (
        <ol className="sa-steps" aria-label={`Steps of ${row.name}`}>
          {steps.map((step, index) => (
            <li key={`${step.name}-${index}`}>
              <StepIcon
                step={{ name: step.name, status: step.done ? 'done' : 'open' }}
                working={live && row.state === 'working'}
              />
              <span>
                <StepName name={step.name} />
              </span>
            </li>
          ))}
        </ol>
      )}
      {row.files.length > 0 && (
        <p className="sa-list">
          <b>Changed</b>{' '}
          {row.files.map((path) => (
            <code key={path} title={path}>
              {fileLabel(path)}
            </code>
          ))}
        </p>
      )}
      {row.commands.length > 0 && (
        <p className="sa-list">
          <b>Ran</b>{' '}
          {row.commands.map((command, index) => (
            <code key={`${command}-${index}`}>{command}</code>
          ))}
        </p>
      )}
      {said && (
        <section className="sa-section" aria-label={row.message ? 'Its report' : 'Its summary'}>
          <b className="sa-heading">{row.message ? 'Its report' : 'Its summary'}</b>
          <Markdown text={said} />
        </section>
      )}
    </div>
  );
}
