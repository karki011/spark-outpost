import type { ProviderOutput } from './provider.ts';

const FAKE_DIFFS_TRIGGER = '#diffs';

export function diffSteps(prompt: string): ProviderOutput[] {
  if (!prompt.includes(FAKE_DIFFS_TRIGGER)) return [];
  const name = 'Editing files';
  return [
    { kind: 'step_started', name, tool: true },
    {
      kind: 'step_finished',
      name,
      diffs: [
        {
          path: '/work/app/src/notes.ts',
          oldText: 'one\ntwo\n',
          newText: 'one\n2\nthree\n',
        },
        { path: '/work/app/.env', withheld: true },
      ],
    },
  ];
}
