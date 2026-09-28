import {
  CHECKPOINT_OPTION,
  type CheckpointKind,
  type InvolvementLevel,
} from '@spark-outpost/contracts';
import { asksWhenUnsure } from '../advisor/gate.ts';

export function asksToKeep(level: InvolvementLevel, filesChanged: number): boolean {
  if (filesChanged === 0) return false;
  return level === 'hands-on' || level === 'balanced';
}

export function fixesFindingsItself(level: InvolvementLevel): boolean {
  return level !== 'hands-on';
}

export function asksForLoop(level: InvolvementLevel): boolean {
  return asksWhenUnsure(level);
}

export function autoContinueOption(kind: CheckpointKind, interpret: boolean): string | null {
  if (kind === 'clarify' && interpret) return CHECKPOINT_OPTION.clarifyRules;
  if (kind === 'retry') return CHECKPOINT_OPTION.stopReport;
  if (kind === 'stuck') return CHECKPOINT_OPTION.stopReport;
  if (kind === 'verify') return CHECKPOINT_OPTION.finishUnverified;
  return null;
}
