export interface UserTextInput {
  userRequest: string;
  outpostRequest?: { fromUser: boolean } | null | undefined;
}

export function userText(input: UserTextInput): string {
  if (input.outpostRequest && !input.outpostRequest.fromUser) return '';
  return input.userRequest;
}

export interface WrapUpInput {
  outpostRequest?: { wrapUp?: boolean } | null | undefined;
}

export function isStoryWrapUp(input: WrapUpInput): boolean {
  return input.outpostRequest?.wrapUp === true;
}
