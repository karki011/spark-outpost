import { expect, it } from 'vitest';
import { codeModeResult } from './results.ts';

it('keeps failed calls and non-JSON evidence distinguishable from decoded results', () => {
  expect(
    codeModeResult({ isError: true, content: [{ type: 'text', text: 'Not allowed' }] }),
  ).toEqual({
    isError: true,
    content: [{ type: 'text', text: 'Not allowed' }],
  });
  const content = [{ type: 'text' as const, text: '<untrusted>ticket data</untrusted>' }];
  expect(codeModeResult({ content })).toEqual({ isError: false, content });
  expect(codeModeResult({ content: [{ type: 'text', text: '{"clipped":…' }] })).not.toHaveProperty(
    'data',
  );
});

it('preserves all content blocks without attempting to join them into JSON', () => {
  const content = [
    { type: 'text' as const, text: 'null' },
    { type: 'text' as const, text: 'false' },
  ];
  expect(codeModeResult({ content })).toEqual({ isError: false, content });
  expect(codeModeResult({ content: [{ type: 'text', text: 'null' }] })).toMatchObject({
    data: null,
  });
});
