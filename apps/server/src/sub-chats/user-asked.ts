import type { ChatAskKind } from '@spark-outpost/contracts';

export interface UserTextInput {
  userRequest: string;
  outpostRequest?: { fromUser: boolean } | null | undefined;
  sparkRuleRetry?: boolean | undefined;
  assistantSent?: boolean | undefined;
}

export function userText(input: UserTextInput): string {
  if (input.sparkRuleRetry || input.assistantSent) return '';
  if (input.outpostRequest && !input.outpostRequest.fromUser) return '';
  return input.userRequest;
}

export interface WrapUpInput {
  outpostRequest?: { wrapUp?: boolean } | null | undefined;
  chatAsk?: { kind: ChatAskKind } | null | undefined;
}

export function isWrapUp(input: WrapUpInput): boolean {
  return input.outpostRequest?.wrapUp === true || input.chatAsk?.kind === 'wrap_up';
}
