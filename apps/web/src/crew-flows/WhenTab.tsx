import './schedule.css';
import { ForwardIcon } from '../ui/icons.tsx';
import { ActivityList } from './ActivityList.tsx';
import { ScheduleCard } from './ScheduleCard.tsx';
import type { CrewSpark } from './spark-lookup.ts';
import { TriggersCard } from './TriggersCard.tsx';
import type { WorkflowActivity } from './use-activity.ts';
import { MayDoCard, WhereCard } from './WhenSide.tsx';
import type { DraftProblem, WorkflowDraft } from './workflow-draft.ts';

const RECENT_SHOWN = 3;

interface WhenTabProps {
  draft: WorkflowDraft;
  problems: readonly DraftProblem[];
  sparkById: ReadonlyMap<string, CrewSpark>;
  lastRunCostUsd: number | null;
  activity: WorkflowActivity;
  releasing: boolean;
  onChange: (draft: WorkflowDraft) => void;
  onOpenRun: (runId: string) => void;
  onRelease: (holdId: string) => void;
  onAllRuns: () => void;
}

export function WhenTab(props: WhenTabProps) {
  const { draft, problems, activity, onChange } = props;
  const recent = activity.rows.slice(0, RECENT_SHOWN);
  return (
    <div className="wf-when" role="tabpanel" aria-label="When it runs">
      <div className="wf-when-main">
        <ScheduleCard
          schedule={draft.schedule}
          problems={problems}
          lastRunCostUsd={props.lastRunCostUsd}
          onChange={(schedule) => onChange({ ...draft, schedule })}
        />
        <TriggersCard
          triggers={draft.triggers}
          problems={problems}
          onChange={(triggers) => onChange({ ...draft, triggers })}
        />
      </div>
      <div className="wf-when-side">
        <WhereCard draft={draft} onChange={onChange} />
        <MayDoCard
          steps={draft.steps}
          sparkById={props.sparkById}
          edits={draft.triggers.edits}
          onEdits={(edits) => onChange({ ...draft, triggers: { ...draft.triggers, edits } })}
        />
        <section className="wf-card-box" aria-label="Recent">
          <header className="wf-card-head">
            <h3>Recent</h3>
            <button type="button" className="btn ghost sm" onClick={props.onAllRuns}>
              All runs
              <ForwardIcon />
            </button>
          </header>
          {recent.length === 0 && <p className="wf-hint">Nothing has run yet.</p>}
          <ActivityList
            rows={recent}
            label="Recent runs"
            releasing={props.releasing}
            onOpenRun={props.onOpenRun}
            onRelease={props.onRelease}
          />
        </section>
      </div>
    </div>
  );
}
