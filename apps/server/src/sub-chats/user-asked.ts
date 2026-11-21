import type { ChatAskKind } from '@spark-outpost/contracts';

export interface UserTextInput {
  userRequest: string;
  sparkRuleRetry?: boolean | undefined;
  assistantSent?: boolean | undefined;
}

export function userText(input: UserTextInput): string {
  if (input.sparkRuleRetry || input.assistantSent) return '';
  return input.userRequest;
}

export interface WrapUpInput {
  chatAsk?: { kind: ChatAskKind } | null | undefined;
}

export function isWrapUp(input: WrapUpInput): boolean {
  return input.chatAsk?.kind === 'wrap_up';
}
