import './schedule.css';
import { useId, useMemo, useState } from 'react';
import {
  SCHEDULE_EVERY_MAX,
  SCHEDULE_MESSAGE_MAX,
  type ScheduleMissed,
  type ScheduleUnit,
  type WorkflowSchedule,
  type WorkflowScheduleView,
} from '@spark-outpost/contracts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { useProjects } from '../chat/project/use-chat-repos.ts';
import { hourCycle } from '../desktop/hour-cycle.ts';
import { useAddFolder } from '../projects/use-add-folder.tsx';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import { CheckIcon, WarnIcon } from '../ui/icons.tsx';
import { Segmented } from '../ui/Segmented.tsx';
import { useMinuteClock } from '../ui/use-minute-clock.ts';
import { ScheduleHistory } from './ScheduleHistory.tsx';
import {
  DAY_NAMES,
  DAY_ORDER,
  defaultSchedule,
  editSchedule,
  estimateLine,
  nextRunLines,
  scheduleProblem,
  toggleDay,
  windowed,
} from './schedule-model.ts';
import { useSaveSchedule, useWorkflowSchedule } from './use-schedule.ts';

const NO_PROJECT = 'none';
const UNITS: { id: ScheduleUnit; label: string }[] = [
  { id: 'minutes', label: 'Minutes' },
  { id: 'hours', label: 'Hours' },
  { id: 'days', label: 'Days' },
  { id: 'weeks', label: 'Weeks' },
];
const MISSED: { id: ScheduleMissed; label: string }[] = [
  { id: 'run_once', label: 'Run once when back' },
  { id: 'skip', label: 'Skip' },
];

interface ScheduleTabProps {
  workflowId: string;
  name: string;
}

function ScheduleForm({
  workflowId,
  name,
  view,
}: ScheduleTabProps & { view: WorkflowScheduleView }) {
  const ids = useId();
  const minute = useMinuteClock();
  const cycle = hourCycle();
  const projects = useProjects();
  const save = useSaveSchedule(workflowId);
  const [saved, setSaved] = useState(() => view.schedule ?? defaultSchedule(new Date()));
  const [draft, setDraft] = useState(saved);
  const adder = useAddFolder({
    onAdded: (project) => setDraft((current) => ({ ...current, projectId: project.id })),
  });
  const edit = (patch: Partial<WorkflowSchedule>) =>
    setDraft((current) => editSchedule(current, patch, new Date()));

  const problem = scheduleProblem(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const nextLines = useMemo(
    () => nextRunLines(draft, new Date(minute), cycle),
    [draft, minute, cycle],
  );
  const estimate = estimateLine(draft, view.lastRunCostUsd);
  const store = (schedule: WorkflowSchedule) =>
    save.mutate(schedule, {
      onSuccess: () => {
        setSaved(schedule);
        setDraft(schedule);
      },
    });
  const turnOff = () =>
    save.mutate(
      { ...saved, enabled: false },
      {
        onSuccess: () => {
          setSaved({ ...saved, enabled: false });
          setDraft((current) => ({ ...current, enabled: false }));
        },
      },
    );
  const choices = [
    { id: NO_PROJECT, label: 'No project' },
    ...(projects.data ?? []).map((project) => ({ id: project.id, label: project.name })),
  ];
  const state = draft.enabled
    ? `On${nextLines[0] ? ` · next run ${nextLines[0]}` : ''}`
    : 'Off · nothing starts on its own';

  return (
    <div className="wf-body">
      <div className="wf-col wf-sched" role="group" aria-label={`Schedule of ${name}`}>
        <div className="wf-sched-switch">
          <BlobToggle
            label="Run on a schedule"
            checked={draft.enabled}
            disabled={(!draft.enabled && problem !== null) || save.isPending}
            describedBy={`${ids}-state`}
            onChange={(enabled) => (enabled ? store({ ...draft, enabled }) : turnOff())}
          />
          <span>
            <b>Run on a schedule</b>
            <small id={`${ids}-state`} role="status">
              {state}
            </small>
          </span>
        </div>

        <div className="wf-sched-field">
          <label htmlFor={`${ids}-every`}>Every</label>
          <div className="wf-sched-line">
            <input
              id={`${ids}-every`}
              className="inp wf-sched-num"
              type="number"
              inputMode="numeric"
              min={1}
              max={SCHEDULE_EVERY_MAX}
              value={draft.every || ''}
              aria-invalid={problem !== null && !Number.isInteger(draft.every) ? true : undefined}
              onChange={(event) => edit({ every: Number.parseInt(event.target.value, 10) || 0 })}
            />
            <Segmented
              ariaLabel="Unit"
              options={UNITS}
              value={draft.unit}
              onChange={(unit) => edit({ unit: unit as ScheduleUnit })}
            />
          </div>
        </div>

        <div className="wf-sched-field">
          <span id={`${ids}-days`}>Only on</span>
          <div className="wf-sched-days" role="group" aria-labelledby={`${ids}-days`}>
            {DAY_ORDER.map((day) => (
              <button
                key={day}
                type="button"
                className="wf-sched-day"
                aria-pressed={draft.days.includes(day)}
                aria-label={DAY_NAMES[day]}
                onClick={() => edit({ days: toggleDay(draft.days, day) })}
              >
                {DAY_NAMES[day]!.slice(0, 1)}
              </button>
            ))}
          </div>
          <p className="wf-hint">
            {draft.days.length === 0
              ? 'No day picked: it runs every day.'
              : 'Runs on the days picked.'}
          </p>
        </div>

        {windowed(draft.unit) ? (
          <div className="wf-sched-field">
            <span id={`${ids}-hours`}>Only between</span>
            <div className="wf-sched-line" role="group" aria-labelledby={`${ids}-hours`}>
              <input
                className="inp wf-sched-time"
                type="time"
                aria-label="From"
                value={draft.from}
                onChange={(event) => edit({ from: event.target.value || '00:00' })}
              />
              <span>and</span>
              <input
                className="inp wf-sched-time"
                type="time"
                aria-label="Until"
                value={draft.to ?? ''}
                onChange={(event) => edit({ to: event.target.value || null })}
              />
            </div>
            <p className="wf-hint">Leave the second time empty to run until midnight.</p>
          </div>
        ) : (
          <div className="wf-sched-field">
            <label htmlFor={`${ids}-at`}>At</label>
            <input
              id={`${ids}-at`}
              className="inp wf-sched-time"
              type="time"
              value={draft.from}
              onChange={(event) => edit({ from: event.target.value || '00:00' })}
            />
          </div>
        )}

        <div className="wf-sched-field">
          <span>In project</span>
          <ChoicePicker
            label="In project"
            choices={choices}
            value={draft.projectId ?? NO_PROJECT}
            actions={adder.actions}
            onChange={(id) => edit({ projectId: id === NO_PROJECT ? null : id })}
          />
          {adder.flow}
        </div>

        <div className="wf-sched-field">
          <label htmlFor={`${ids}-message`}>What to tell the workflow</label>
          <textarea
            id={`${ids}-message`}
            className="inp wf-sched-message"
            rows={3}
            maxLength={SCHEDULE_MESSAGE_MAX}
            value={draft.message}
            placeholder="Review everything merged since the last run."
            onChange={(event) => edit({ message: event.target.value })}
          />
        </div>

        <div className="wf-sched-field">
          <span id={`${ids}-missed`}>If the Mac was asleep or Spark was closed</span>
          <Segmented
            ariaLabel="If the Mac was asleep or Spark was closed"
            options={MISSED}
            value={draft.missed}
            onChange={(missed) => edit({ missed: missed as ScheduleMissed })}
          />
        </div>

        <div className="wf-sched-field">
          <span id={`${ids}-next`}>Next runs</span>
          <ol className="wf-sched-next" aria-labelledby={`${ids}-next`}>
            {nextLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
          {estimate && <p className="wf-hint">{estimate}</p>}
          <p className="wf-hint">Nothing caps a schedule. This is an estimate, not a limit.</p>
        </div>

        {problem !== null && (
          <p className="wf-problem" role="status">
            <WarnIcon />
            <span>
              <b>Can’t save yet</b> · {problem}
            </span>
          </p>
        )}
        {save.error && (
          <p className="wf-problem wf-error" role="alert">
            <WarnIcon />
            <span>
              <b>Couldn’t save</b> · {save.error.message}
            </span>
          </p>
        )}
        <div className="wf-sched-line">
          <button
            type="button"
            className="btn primary sm"
            disabled={problem !== null || !dirty || save.isPending}
            onClick={() => store(draft)}
          >
            Save schedule
          </button>
          <span role="status">
            {dirty && <span className="wf-hint">Not saved</span>}
            {!dirty && view.schedule !== null && (
              <span className="wf-state" data-state="succeeded">
                <CheckIcon className="wf-state-ic" />
                Saved
              </span>
            )}
          </span>
        </div>
      </div>
      <ScheduleHistory workflowId={workflowId} />
    </div>
  );
}

export function ScheduleTab({ workflowId, name }: ScheduleTabProps) {
  const view = useWorkflowSchedule(workflowId);
  if (view.error) {
    return (
      <p className="wf-problem wf-error" role="alert">
        <WarnIcon />
        <span>
          <b>Couldn’t load the schedule</b> · {view.error.message}
        </span>
      </p>
    );
  }
  if (!view.data) return <div className="wf-body" aria-busy="true" />;
  return <ScheduleForm workflowId={workflowId} name={name} view={view.data} />;
}
