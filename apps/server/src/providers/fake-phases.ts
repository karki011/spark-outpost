import type { ProviderOutput } from './provider.ts';

const FAKE_COMMENTARY_TRIGGER = '#commentary';
export const FAKE_COMMENTARY = [
  'I will read the message before I answer.',
  'Now I will write the reply.',
];

function narrates(prompt: string): boolean {
  return prompt.includes(FAKE_COMMENTARY_TRIGGER);
}

export function fakeCommentary(prompt: string): ProviderOutput[] {
  if (!narrates(prompt)) return [];
  return FAKE_COMMENTARY.map((line, index): ProviderOutput => ({
    kind: 'text_delta',
    delta: index === 0 ? line : `\n\n${line}`,
    phase: 'commentary',
  }));
}

export function asFinalMessage(prompt: string, outputs: ProviderOutput[]): ProviderOutput[] {
  if (!narrates(prompt)) return outputs;
  const first = outputs.findIndex((output) => output.kind === 'text_delta');
  return outputs.map((output, index): ProviderOutput => {
    if (output.kind !== 'text_delta') return output;
    return {
      ...output,
      delta: index === first ? `\n\n${output.delta}` : output.delta,
      phase: 'final',
    };
  });
}
