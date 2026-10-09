export interface UserTextInput {
  userRequest: string;
  outpostRequest?: { fromUser: boolean } | null | undefined;
}

export function userText(input: UserTextInput): string {
  if (input.outpostRequest && !input.outpostRequest.fromUser) return '';
  return input.userRequest;
}
