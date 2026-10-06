import type { ApprovalRequest } from './decide.ts';
import { egressOf, egressTarget } from './egress.ts';
import type { FileLister } from './file-lister.ts';
import type { OwnRepo } from './own-repo.ts';
import type { SecretSend } from './secret-send.ts';

const SHOWN = 3;

export interface SentOut {
  observed: string[];
  target: string;
}

export interface TaintFacts {
  observed?: readonly string[];
  own?: OwnRepo | null;
  secretSend?: SecretSend;
}

export function observedList(observed: readonly string[]): string {
  const shown = observed.slice(0, SHOWN);
  const rest = observed.length - shown.length;
  const joined =
    shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : (shown[0] ?? '');
  return rest > 0 ? `${shown.join(', ')} and ${rest} more` : joined;
}

export function sentOut(
  request: ApprovalRequest,
  files: FileLister,
  facts: TaintFacts,
): SentOut | null {
  const observed = facts.observed ?? [];
  if (observed.length === 0) return null;
  const own = facts.secretSend?.kind === 'unreadable' ? null : (facts.own ?? null);
  const egress = egressOf(request, files, own);
  return egress ? { observed: [...observed], target: egressTarget(egress) } : null;
}

export function secretSendReason(files: readonly string[]): string {
  return `This sends a value from ${observedList(files)} off this computer`;
}
