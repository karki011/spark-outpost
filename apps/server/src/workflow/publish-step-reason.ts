import { asksPushOnly, requestedBy } from '../approvals/publish-policy.ts';
import { isStoryWrapUp, userText } from '../outposts/user-asked.ts';
import type { PublishReason } from './publish-prompt.ts';
import type { RunInput } from './run-input.ts';

export type ReasonFacts = Pick<
  RunInput,
  | 'mode'
  | 'level'
  | 'userRequest'
  | 'followUpRound'
  | 'outpostRequest'
  | 'parentRunId'
  | 'assistant'
  | 'sparkRuleRetry'
  | 'assistantSent'
  | 'chatFolder'
>;

export function publishReason(input: ReasonFacts): PublishReason | null {
  if (input.mode !== 'do' || input.assistant || input.chatFolder) return null;
  if (input.parentRunId !== null) return null;
  if (isStoryWrapUp(input)) return null;
  if (input.followUpRound) return 'follow-up';
  const asked = requestedBy(userText(input));
  if (asked.requested)
    return asksPushOnly({ level: input.level, ...asked }) ? 'asked-push' : 'asked';
  return input.level === 'full-auto' ? 'full-auto' : null;
}
