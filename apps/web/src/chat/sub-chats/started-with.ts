import {
  autonomyLabel,
  type ProviderCapabilities,
  type SubChatStartedWith,
} from '@spark-outpost/contracts';
import { modelName } from '../../tasks/model-names.ts';
import { modeLabel } from '../composer/mode-summary.ts';

export function startedWithLine(
  startedWith: SubChatStartedWith,
  capabilities: ProviderCapabilities | undefined,
  branch: string | null,
): string {
  const effort = capabilities?.efforts.find((option) => option.id === startedWith.effort);
  const parts = [
    modelName(capabilities?.models ?? [], startedWith.model),
    startedWith.effort ? `${(effort?.label ?? startedWith.effort).toLowerCase()} effort` : null,
    startedWith.agentMode ? modeLabel(capabilities?.modes ?? [], startedWith.agentMode) : null,
    startedWith.level ? autonomyLabel(startedWith.level) : null,
    branch ? `branch ${branch}` : null,
  ];
  return `Started with ${parts.filter(Boolean).join(' · ')}`;
}
