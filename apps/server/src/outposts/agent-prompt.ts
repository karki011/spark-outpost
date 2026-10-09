import type { RunInput } from '../workflow/run-input.ts';
import { requestAuthor, wrapRequest } from './request-prompt.ts';

type AgentText = Pick<RunInput, 'prompt' | 'followUp' | 'userRequest' | 'outpostRequest'>;

function isSlashCommand(text: string): boolean {
  return text.trimStart().startsWith('/');
}

export function asAgentReads<T extends AgentText>(input: T): T {
  const request = input.outpostRequest;
  const body = input.userRequest;
  if (!request || body.length === 0) return input;
  if (request.fromUser && isSlashCommand(body)) return input;
  const wrapped = wrapRequest({
    postId: request.postId,
    outpostName: request.outpostName,
    author: requestAuthor(request),
    body,
  });
  const prompt = input.prompt.startsWith(body)
    ? `${wrapped}${input.prompt.slice(body.length)}`
    : input.prompt;
  const followUp = input.followUp?.endsWith(body)
    ? `${input.followUp.slice(0, -body.length)}${wrapped}`
    : input.followUp;
  return { ...input, prompt, ...(followUp === undefined ? {} : { followUp }) };
}
