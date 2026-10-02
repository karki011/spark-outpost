import { turnCategory } from '../advisor/intake-recorder.ts';
import type { Session } from '../orchestration/session.ts';

export function taskKind(s: Pick<Session, 'intake'>): string {
  return turnCategory(s.intake.outcome, s.intake.body.rules.intent) ?? 'other';
}
