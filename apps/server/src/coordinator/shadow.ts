import { track } from '../orchestration/observe.ts';
import type { CoordinatorMode, Session } from '../orchestration/session.ts';
import { assess, recordAssessment } from './assess.ts';

export function coordinatorMode(s: Session): CoordinatorMode {
  return s.deps.coordinator ?? 'off';
}

export function mayCoordinate(s: Session): boolean {
  return (
    s.input.mode === 'do' &&
    s.input.projectRoots.length > 0 &&
    s.taskId !== null &&
    !s.flow.solo &&
    !s.facts.trivial
  );
}

export function observeCoordination(s: Session): void {
  if (coordinatorMode(s) !== 'shadow' || !mayCoordinate(s)) return;
  track(
    s,
    assess(s).then((assessment) => recordAssessment(s, assessment, true)),
  );
}
