import { describe, expect, it } from 'vitest';
import { FAKE_PR_URL, createFakeProvider, fakeProviderPlan, fakeReply } from './fake.ts';

describe('fake provider', () => {
  it('streams steps before text and the text reassembles to the reply', () => {
    const plan = fakeProviderPlan('Hi there');
    expect(plan[0]).toEqual({ kind: 'step_started', name: 'Reading your message' });
    const text = plan
      .filter((output) => output.kind === 'text_delta')
      .map((output) => output.delta)
      .join('');
    expect(text).toBe(fakeReply('Hi there'));
  });

  it('reads attachments and names them in the reply', () => {
    const plan = fakeProviderPlan('Look', [{ name: 'a.png' }, { name: 'b.txt' }]);
    expect(plan).toContainEqual({ kind: 'step_started', name: 'Reading 2 attachments' });
    const text = plan
      .filter((output) => output.kind === 'text_delta')
      .map((output) => output.delta)
      .join('');
    expect(text.endsWith(' Attachments: a.png, b.txt.')).toBe(true);
  });

  it('names the linked repos in order', () => {
    expect(fakeReply('Look', [{ name: 'a.txt' }], ['/work/app', '/work/lib'])).toMatch(
      / Attachments: a\.txt\. Repos: app, lib\.$/,
    );
  });

  it('sends a plan that progresses, uses a tool and names a pull request on #plan', () => {
    const plan = fakeProviderPlan('Fix it #plan');
    const statuses = plan.flatMap((output) =>
      output.kind === 'plan' ? [output.entries.map((entry) => entry.status).join(',')] : [],
    );
    expect(statuses).toEqual([
      'in_progress,pending,pending',
      'completed,in_progress,pending',
      'completed,completed,completed',
    ]);
    expect(plan).toContainEqual({ kind: 'step_started', name: 'Searched the code', tool: true });
    const text = plan.map((output) => (output.kind === 'text_delta' ? output.delta : '')).join('');
    expect(text).toContain(FAKE_PR_URL);
    expect(fakeProviderPlan('Hi').some((output) => output.kind === 'plan')).toBe(false);
  });

  it('stops when the signal aborts', async () => {
    const provider = createFakeProvider({ stepMs: 5, wordMs: 5 });
    const controller = new AbortController();
    const seen: string[] = [];
    await expect(async () => {
      for await (const output of provider.run({
        prompt: 'x',
        history: [],
        settings: { method: null, model: null, modelLabel: null, effort: null },
        signal: controller.signal,
      })) {
        seen.push(output.kind);
        controller.abort();
      }
    }).rejects.toThrow();
    expect(seen).toEqual(['step_started']);
  });
});
