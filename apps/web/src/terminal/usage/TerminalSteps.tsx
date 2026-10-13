import './terminal-usage.css';
import { useQuery } from '@tanstack/react-query';
import { TaskStateIcon } from '../../tasks/TaskIcons.tsx';
import { QueryWait } from '../../ui/loading/QueryWait.tsx';
import { Skeleton } from '../../ui/loading/Skeleton.tsx';
import { STEP_STATE_NAMES, stepRows, type StepState } from './step-rows.ts';
import { terminalUsageQuery } from './terminal-usage-api.ts';

function StepIcon({ state }: { state: StepState }) {
  if (state === 'unknown')
    return <span className="ic pend" role="img" aria-label={STEP_STATE_NAMES.unknown} />;
  return <TaskStateIcon state={state} />;
}

export function TerminalSteps({ conversationId }: { conversationId: string }) {
  const usage = useQuery(terminalUsageQuery(conversationId));
  if (!usage.data)
    return (
      <div className="wsec">
        <QueryWait query={usage} what="the steps">
          <Skeleton label="Opening Steps" shape="list" />
        </QueryWait>
      </div>
    );
  const turns = usage.data.turns.map((turn, index) => ({ turn, number: index + 1 })).toReversed();
  return (
    <div className="wsec tu-steps">
      {turns.length === 0 && <p className="wnote first">No turns yet.</p>}
      {turns.map(({ turn, number }) => {
        const rows = stepRows(turn);
        return (
          <section key={turn.runId} aria-label={`Turn ${number} steps`}>
            <div className="wsec-h">
              <h3>Turn {number}</h3>
              <span className="tu-count">
                {rows.length === 1 ? '1 step' : `${rows.length} steps`}
              </span>
            </div>
            {rows.length === 0 ? (
              <p className="wnote first">No tool calls observed.</p>
            ) : (
              <ol className="tu-list">
                {rows.map((row) => (
                  <li key={row.id} data-state={row.state}>
                    <StepIcon state={row.state} />
                    <span className="tu-name">{row.name}</span>
                    {row.subagent && <span className="tu-tag">sub-agent</span>}
                    <span className="tu-time">{row.time}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        );
      })}
      <p className="wnote">
        Tool names and times come from the agent&apos;s own hooks. Commands, paths and results are
        not recorded.
      </p>
    </div>
  );
}
