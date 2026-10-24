import { isSparkNote, type SubagentRow } from '@spark-outpost/contracts';
import { StepIcon, StepName } from '../WorkLog.tsx';
import { fileLabel } from './subagent-view.ts';

interface SubagentDetailProps {
  id: string;
  row: SubagentRow;
  task: string | null;
  live: boolean;
}

export function SubagentDetail({ id, row, task, live }: SubagentDetailProps) {
  const said = row.message ?? row.summary ?? null;
  const steps = row.steps.filter((step) => !isSparkNote(step.name));
  return (
    <div id={id} className="sa-detail">
      {task && <p className="sa-task open">{task}</p>}
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
        <div className="sa-said">
          <b>{row.message ? 'Its report' : 'Its summary'}</b>
          <p>{said}</p>
        </div>
      )}
    </div>
  );
}
