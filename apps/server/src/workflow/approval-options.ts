import type { Approval, ApprovalOption, SparkRuleRefusal } from '@spark-outpost/contracts';
import { normalizeCommand } from '../approvals/commands.ts';
import type { Decision, RunRule } from '../approvals/decide.ts';

export type Asking = Pick<
  Extract<Decision, { verdict: 'ask' }>,
  | 'forcePush'
  | 'instructionFiles'
  | 'gitControl'
  | 'because'
  | 'observed'
  | 'sendsTo'
  | 'secretSend'
  | 'secretFiles'
> & { sparkRule?: SparkRuleRefusal; outsideWrite?: string | true };

function onceOnly(asking: Asking): boolean {
  return Boolean(
    asking.forcePush ||
    asking.secretSend ||
    asking.gitControl ||
    asking.instructionFiles ||
    asking.outsideWrite !== undefined,
  );
}

const PROTECTED_NAMES: Partial<Record<ApprovalOption['kind'], string>> = {
  allow_once: 'Allow once',
  reject_once: 'Deny',
};

export function askedOptions(options: readonly ApprovalOption[], asking: Asking): ApprovalOption[] {
  if (!onceOnly(asking)) return [...options];
  const once = options.filter((option) => option.kind !== 'allow_always');
  if (!asking.instructionFiles && asking.outsideWrite === undefined) return once;
  return once.map((option) => ({ ...option, name: PROTECTED_NAMES[option.kind] ?? option.name }));
}

export function allowOption(options: readonly ApprovalOption[]): ApprovalOption | undefined {
  return (
    options.find((option) => option.kind === 'allow_once') ??
    options.find((option) => option.kind === 'allow_always')
  );
}

export function rejectOption(options: readonly ApprovalOption[]): ApprovalOption | undefined {
  return (
    options.find((option) => option.kind === 'reject_once') ??
    options.find((option) => option.kind === 'reject_always')
  );
}

export function toRule(approval: Pick<Approval, 'kind' | 'title' | 'payload'>): RunRule | null {
  if (approval.kind === 'execute') {
    return approval.payload.command
      ? { kind: 'execute', command: normalizeCommand(approval.payload.command) }
      : null;
  }
  if (approval.kind === 'edit') return { kind: 'edit' };
  return { kind: 'other', title: approval.title };
}

export function userNote(approval: Approval, what: string): string {
  if (approval.status === 'denied') return `Denied: ${what} (you denied it)`;
  if (approval.scope === 'run') return `Allowed ${what} (you allowed it for this run)`;
  if (approval.scope === 'chat' && approval.payload.outsideWrite !== undefined) {
    return `Allowed ${what} (you allowed writes outside the project for this session)`;
  }
  if (approval.scope === 'chat') return `Allowed ${what} (you allowed it for this chat)`;
  if (approval.scope === 'project') return `Allowed ${what} (you always allow it in this project)`;
  return `Allowed ${what} (you allowed it)`;
}
