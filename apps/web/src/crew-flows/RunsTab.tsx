import { WarnIcon } from '../ui/icons.tsx';
import { ActivityList } from './ActivityList.tsx';
import type { WorkflowActivity } from './use-activity.ts';

interface RunsTabProps {
  saved: boolean;
  activity: WorkflowActivity;
  releasing: boolean;
  releaseError: string | null;
  onOpenRun: (runId: string) => void;
  onRelease: (holdId: string) => void;
}

export function RunsTab(props: RunsTabProps) {
  const { saved, activity, releaseError } = props;
  return (
    <div
      className="wf-runs-tab"
      role="tabpanel"
      aria-label="Runs"
      aria-busy={activity.loading || undefined}
    >
      <p className="wf-hint">
        Every run of this workflow and where it started, newest first, with scheduled times and
        triggers that did not start a run. Releasing a held publish never pushes: the chat publishes
        on its next Full auto turn, or when you ask for it in a message.
      </p>
      {activity.error && (
        <p className="wf-problem" role="alert">
          <WarnIcon />
          <span>
            <b>Couldn’t load the runs</b> · {activity.error.message}
          </span>
        </p>
      )}
      {releaseError !== null && (
        <p className="wf-problem" role="alert">
          <WarnIcon />
          <span>
            <b>Couldn’t release</b> · {releaseError}
          </span>
        </p>
      )}
      {!saved && <p className="wf-hint">Save the workflow to run it. Runs show here.</p>}
      {saved && !activity.loading && !activity.error && activity.rows.length === 0 && (
        <p className="wf-hint">Not run yet. Runs show here, newest first.</p>
      )}
      <ActivityList
        rows={activity.rows}
        label="Runs"
        releasing={props.releasing}
        onOpenRun={props.onOpenRun}
        onRelease={props.onRelease}
      />
    </div>
  );
}
