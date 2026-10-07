import { EventType, stepMark, type RunEvent, type StepMark } from '@spark-outpost/contracts';
import { runEvents } from './run-events.ts';

export interface OpenSpans {
  observe(event: RunEvent): void;
  closers(): RunEvent[];
}

export function trackOpenSpans(): OpenSpans {
  const steps = new Map<string, StepMark>();
  return {
    observe(event) {
      if (event.type === EventType.STEP_STARTED) steps.set(event.stepName, stepMark(event));
      if (event.type === EventType.STEP_FINISHED) steps.delete(event.stepName);
    },
    closers() {
      const closing = [...steps].map(([name, mark]) =>
        runEvents.stepFinished(name, { ...mark, interrupted: true }),
      );
      steps.clear();
      return closing;
    },
  };
}
