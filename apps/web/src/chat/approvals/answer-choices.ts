import {
  holdsToConfirm,
  type Approval,
  type ApprovalOption,
  type ApprovalScope,
} from '@spark-outpost/contracts';
import { isAllow, projectAllowOption, shownOptions } from './approval-outcome.ts';

export interface AlwaysChoice {
  label: string;
  optionId: string;
  scope: ApprovalScope;
  unavailableReason?: string | undefined;
}

export interface AnswerChoices {
  allow: ApprovalOption | undefined;
  allowLabel: string;
  always: AlwaysChoice[];
  deny: ApprovalOption | undefined;
  otherRejects: ApprovalOption[];
}

function firstOf(options: readonly ApprovalOption[], kind: ApprovalOption['kind']) {
  return options.find((option) => option.kind === kind) ?? options[0];
}

function agentAlways(allows: readonly ApprovalOption[], allow: ApprovalOption): AlwaysChoice[] {
  return allows
    .filter((option) => option !== allow)
    .map((option) => ({
      label: option.name,
      optionId: option.optionId,
      scope: 'once',
      unavailableReason: option.unavailableReason,
    }));
}

function chatChoice(approval: Approval): AlwaysChoice[] {
  const { instructionFiles, outsideWrite } = approval.payload;
  if (instructionFiles === undefined && outsideWrite === undefined) return [];
  const once = approval.options.find((option) => option.kind === 'allow_once');
  if (!once) return [];
  const label = outsideWrite === undefined ? 'Allow for this chat' : 'Allow for this session';
  return [{ label, optionId: once.optionId, scope: 'chat' }];
}

function projectChoice(approval: Approval): AlwaysChoice[] {
  const { command, plan } = approval.payload;
  if (approval.reason !== null || plan || approval.kind !== 'execute' || !command) return [];
  const option = projectAllowOption(approval.options);
  if (!option) return [];
  return [{ label: 'Always allow in this project', optionId: option.optionId, scope: 'project' }];
}

export function answerChoices(approval: Approval): AnswerChoices {
  const shown = shownOptions(approval);
  const rejects = shown.filter((option) => !isAllow(option));
  const deny = firstOf(rejects, 'reject_once');
  const otherRejects = rejects.filter((option) => option !== deny);
  const allows = holdsToConfirm(approval.payload) ? [] : shown.filter(isAllow);
  const allow = firstOf(allows, 'allow_once');
  if (!allow) return { allow, allowLabel: '', always: [], deny, otherRejects };
  return {
    allow,
    allowLabel:
      approval.payload.instructionFiles || approval.payload.outsideWrite !== undefined
        ? 'Allow once'
        : allow.name,
    always: [...agentAlways(allows, allow), ...chatChoice(approval), ...projectChoice(approval)],
    deny,
    otherRejects,
  };
}
