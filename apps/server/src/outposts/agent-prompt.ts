import { REQUEST_LIMIT } from '../orchestration/context.ts';
import type { RunInput } from '../workflow/run-input.ts';
import { requestAuthor, wrapRequest } from './request-prompt.ts';

type AgentText = Pick<RunInput, 'prompt' | 'followUp' | 'userRequest' | 'outpostRequest'>;

function isSlashCommand(text: string): boolean {
  return text.trimStart().startsWith('/');
}

function onItsOwnLines(text: string, start: number, end: number): boolean {
  const opens = start === 0 || text[start - 1] === '\n';
  const closes = end === text.length || text[end] === '\n';
  return opens && closes;
}

function formsIn(body: string): string[] {
  return body.length > REQUEST_LIMIT ? [body, body.slice(0, REQUEST_LIMIT)] : [body];
}

function withRequestLabelled(text: string, body: string, wrap: (body: string) => string): string {
  const forms = formsIn(body);
  const shortest = forms.at(-1)!;
  let labelled = '';
  let copied = 0;
  let at = text.indexOf(shortest);
  while (at !== -1) {
    const start = at;
    const found = forms.find(
      (form) => text.startsWith(form, start) && onItsOwnLines(text, start, start + form.length),
    );
    if (found === undefined) {
      at = text.indexOf(shortest, start + 1);
      continue;
    }
    labelled += text.slice(copied, start) + wrap(found);
    copied = start + found.length;
    at = text.indexOf(shortest, copied);
  }
  return labelled + text.slice(copied);
}

export function asAgentReads<T extends AgentText>(input: T): T {
  const request = input.outpostRequest;
  const body = input.userRequest;
  if (!request || body.length === 0) return input;
  if (request.fromUser && isSlashCommand(body)) return input;
  const author = requestAuthor(request);
  const wrap = (kept: string) =>
    wrapRequest({
      postId: request.postId,
      outpostName: request.outpostName,
      author,
      body: kept,
    });
  const prompt = withRequestLabelled(input.prompt, body, wrap);
  const followUp =
    typeof input.followUp === 'string'
      ? withRequestLabelled(input.followUp, body, wrap)
      : input.followUp;
  return { ...input, prompt, ...(followUp === undefined ? {} : { followUp }) };
}
