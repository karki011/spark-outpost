import { ProviderError, type ProviderOutput } from '../providers/provider.ts';
import { APPROVAL_TIMEOUT_MESSAGE } from './approval-gate.ts';
import type { StopReason } from './run-control.ts';

const GENERIC_PROVIDER_FAILURE =
  'The provider stopped with an unexpected error. Nothing after the last completed step was changed.';

export function failureMessage(error: unknown, reason: StopReason | null): string {
  if (reason === 'approval_timeout') return APPROVAL_TIMEOUT_MESSAGE;
  if (error instanceof ProviderError) return error.message;
  console.error('Run failed unexpectedly', error);
  return GENERIC_PROVIDER_FAILURE;
}

const KEPT_AFTER_CANCEL: ReadonlySet<ProviderOutput['kind']> = new Set([
  'step_started',
  'step_finished',
  'tool_started',
  'tool_input',
  'tool_result',
  'command_started',
  'command_described',
  'command_output',
  'command_finished',
  'subagent_started',
  'subagent_report',
  'subagent_finished',
]);

function droppedAfterCancel(output: ProviderOutput): boolean {
  if (output.kind === 'step_started') return !output.tool;
  return output.kind === 'step_finished' && output.failed === true;
}

export function keptAfterCancel(output: ProviderOutput): boolean {
  return KEPT_AFTER_CANCEL.has(output.kind) && !droppedAfterCancel(output);
}
