import type { RunInput } from './run-input.ts';

export function startsWithCommand(input: Pick<RunInput, 'prompt'>): boolean {
  return input.prompt.trimStart().startsWith('/');
}

export function withAgentNote(input: RunInput, note: string): RunInput {
  if (startsWithCommand(input)) return input;
  return { ...input, followUp: `${note}\n\n${input.followUp ?? input.prompt}` };
}
