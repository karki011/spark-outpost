import { useId, useMemo } from 'react';
import {
  SCHEDULE_MESSAGE_MAX,
  type ScheduleMissed,
  type ScheduleUnit,
} from '@spark-outpost/contracts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { hourCycle } from '../desktop/hour-cycle.ts';
import { Segmented } from '../ui/Segmented.tsx';
import { useMinuteClock } from '../ui/use-minute-clock.ts';
import { FieldProblem } from './FieldProblem.tsx';
import {
  DAY_NAMES,
  DAY_ORDER,
  editSchedule,
  estimateLine,
  nextRunLines,
  toggleDay,
  windowed,
} from './schedule-model.ts';
import { problemOf, toSchedule, type DraftProblem, type ScheduleDraft } from './workflow-draft.ts';
import { hostWords } from '../desktop/host-words.ts';

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

interface ScheduleCardProps {
  schedule: ScheduleDraft;
  problems: readonly DraftProblem[];
  lastRunCostUsd: number | null;
  onChange: (schedule: ScheduleDraft) => void;
}

export function ScheduleCard({ schedule, problems, lastRunCostUsd, onChange }: ScheduleCardProps) {
  const ids = useId();
  const missedLabel = `If the ${hostWords().computer} was asleep or Spark was closed`;
  const minute = useMinuteClock();
  const cycle = hourCycle();
  const edit = (patch: Partial<ScheduleDraft>) =>
    onChange(editSchedule(schedule, patch, new Date()));
  const timing = useMemo(() => toSchedule(schedule), [schedule]);
  const everyProblem = problemOf(problems, 'every');
  const hoursProblem = problemOf(problems, 'hours');
  const valid = everyProblem === null && hoursProblem === null;
  const nextLines = useMemo(
    () => (valid ? nextRunLines(timing, new Date(minute), cycle) : []),
    [valid, timing, minute, cycle],
  );
  const estimate = valid ? estimateLine(timing, lastRunCostUsd) : '';
  const state = schedule.enabled
    ? `On${nextLines[0] ? ` · next run ${nextLines[0]}` : ''}`
    : 'Off · nothing starts on its own';

  return (
    <section className="wf-card-box" role="group" aria-labelledby={`${ids}-title`}>
      <header className="wf-card-head">
        <span>
          <h3 id={`${ids}-title`}>On a schedule</h3>
          <small id={`${ids}-state`} role="status">
            {state}
          </small>
        </span>
        <BlobToggle
          label="Run on a schedule"
          checked={schedule.enabled}
          describedBy={`${ids}-state`}
          onChange={(enabled) => edit({ enabled })}
        />
      </header>

      <div className="wf-sched-line">
        <label htmlFor={`${ids}-every`}>Every</label>
        <input
          id={`${ids}-every`}
          className="inp wf-sched-num"
          inputMode="numeric"
          value={schedule.every}
          aria-invalid={everyProblem !== null || undefined}
          aria-describedby={`${ids}-every-problem`}
          onChange={(event) => edit({ every: event.target.value })}
        />
        <Segmented
          ariaLabel="Unit"
          options={UNITS}
          value={schedule.unit}
          onChange={(unit) => edit({ unit: unit as ScheduleUnit })}
        />
        {windowed(schedule.unit) ? (
          <span className="wf-sched-line" role="group" aria-label="Only between">
            <span>between</span>
            <input
              className="inp wf-sched-time"
              type="time"
              aria-label="From"
              value={schedule.from}
              onChange={(event) => edit({ from: event.target.value || '00:00' })}
            />
            <span>and</span>
            <input
              className="inp wf-sched-time"
              type="time"
              aria-label="Until"
              value={schedule.to ?? ''}
              aria-invalid={hoursProblem !== null || undefined}
              aria-describedby={`${ids}-hours-problem`}
              onChange={(event) => edit({ to: event.target.value || null })}
            />
          </span>
        ) : (
          <>
            <label htmlFor={`${ids}-at`}>at</label>
            <input
              id={`${ids}-at`}
              className="inp wf-sched-time"
              type="time"
              value={schedule.from}
              onChange={(event) => edit({ from: event.target.value || '00:00' })}
            />
          </>
        )}
      </div>
      <FieldProblem id={`${ids}-every-problem`} text={everyProblem} />
      <FieldProblem id={`${ids}-hours-problem`} text={hoursProblem} />
      {windowed(schedule.unit) && (
        <p className="wf-hint">Leave the second time empty to run until midnight.</p>
      )}

      <div className="wf-sched-field">
        <span id={`${ids}-days`}>Only on</span>
        <div className="wf-sched-days" role="group" aria-labelledby={`${ids}-days`}>
          {DAY_ORDER.map((day) => (
            <button
              key={day}
              type="button"
              className="wf-sched-day"
              aria-pressed={schedule.days.includes(day)}
              aria-label={DAY_NAMES[day]}
              onClick={() => edit({ days: toggleDay(schedule.days, day) })}
            >
              {DAY_NAMES[day]!.slice(0, 1)}
            </button>
          ))}
        </div>
        <p className="wf-hint">
          {schedule.days.length === 0
            ? 'No day picked: it runs every day.'
            : 'Runs on the days picked.'}
        </p>
      </div>

      <div className="wf-sched-pair">
        <div className="wf-sched-field">
          <label htmlFor={`${ids}-message`}>What to tell the workflow</label>
          <textarea
            id={`${ids}-message`}
            className="inp wf-sched-message"
            rows={2}
            maxLength={SCHEDULE_MESSAGE_MAX}
            value={schedule.message}
            placeholder="Review everything merged since the last run."
            onChange={(event) => edit({ message: event.target.value })}
          />
        </div>
        <div className="wf-sched-field">
          <span id={`${ids}-missed`}>{missedLabel}</span>
          <Segmented
            ariaLabel={missedLabel}
            options={MISSED}
            value={schedule.missed}
            onChange={(missed) => edit({ missed: missed as ScheduleMissed })}
          />
        </div>
      </div>

      <div className="wf-sched-field">
        <span id={`${ids}-next`}>Next runs</span>
        <ol className="wf-sched-next" aria-labelledby={`${ids}-next`}>
          {nextLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
        {estimate && <p className="wf-hint">{estimate}</p>}
        <p className="wf-hint">
          Nothing caps a schedule. This is an estimate, not a limit. A scheduled run is not your
          message: it can’t ask for a push, a pull request or a Spark action.
        </p>
      </div>
    </section>
  );
}
