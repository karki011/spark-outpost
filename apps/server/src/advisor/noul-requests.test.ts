import { describe, expect, it } from 'vitest';
import { askSystemOne } from './jev.ts';
import { JevLimiter } from './jev-limiter.ts';
import { noulQuestion } from './questions.ts';

async function sentBody(questions: Record<string, unknown>) {
  let sent = '';
  const fetcher = (async (_url: string, init: RequestInit) => {
    sent = String(init.body);
    return new Response(JSON.stringify({ model: 'jev-1.13.0', answers: {} }), { status: 200 });
  }) as unknown as typeof fetch;
  await askSystemOne(
    {
      baseUrl: 'https://jev.test',
      apiKey: 'fake',
      model: 'jev-latest',
      fetch: fetcher,
      limiter: new JevLimiter(4),
    },
    { state: {}, questions },
    new AbortController().signal,
  );
  return JSON.parse(sent) as { questions: Record<string, unknown> };
}

describe('noul requests', () => {
  it('send the yes/no descriptions under true and false, as the API reads them', async () => {
    const criteria = { false: 'It only describes the change', true: 'It asks for a change' };
    const body = await sentBody({
      asks: noulQuestion('Does `comment` ask for a change?', criteria),
    });
    expect(JSON.stringify(body.questions)).toBe(
      JSON.stringify({
        asks: {
          type: 'noul',
          instructions: 'Does `comment` ask for a change?',
          criteria: { true: 'It asks for a change', false: 'It only describes the change' },
        },
      }),
    );
  });
});
