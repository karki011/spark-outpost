import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createAcpProvider } from '../src/agents/acp/acp-provider.ts';
import { agentDefinitions } from '../src/agents/acp/agents.ts';
import type { ConversationTurn, ProviderOutput } from '../src/providers/provider.ts';

const outside = mkdtempSync(join(import.meta.dirname, '..', '..', '..', '.local', 'live-'));
afterAll(() => rmSync(outside, { recursive: true, force: true }));

async function run(
  id: 'claude' | 'codex',
  prompt: string,
  history: ConversationTurn[] = [],
  stopWhen?: (outputs: ProviderOutput[]) => boolean,
) {
  const provider = createAcpProvider({ definition: agentDefinitions[id] });
  const controller = new AbortController();
  const outputs: ProviderOutput[] = [];
  const started = Date.now();
  let abortedAt: number | null = null;
  for await (const output of provider.run({
    prompt,
    history,
    settings: { method: 'cli', model: null, modelLabel: null, effort: 'low' },
    signal: controller.signal,
  })) {
    outputs.push(output);
    if (abortedAt === null && stopWhen?.(outputs)) {
      abortedAt = Date.now();
      controller.abort();
    }
  }
  const text = outputs.map((output) => (output.kind === 'text_delta' ? output.delta : '')).join('');
  const steps = outputs.flatMap((output) => (output.kind === 'step_started' ? [output.name] : []));
  return {
    text,
    steps,
    elapsedMs: Date.now() - started,
    stopMs: abortedAt && Date.now() - abortedAt,
  };
}

describe.each(['claude', 'codex'] as const)('live %s over ACP', (id) => {
  it('answers from the saved conversation', async () => {
    const { text } = await run(id, 'What was the codeword? Reply with the codeword only.', [
      { role: 'user', content: 'Remember this codeword: HERON-42.' },
      { role: 'assistant', content: 'Got it.' },
    ]);
    expect(text).toContain('HERON-42');
  });

  it('cannot write files in a chat without a project folder', async () => {
    const target = join(outside, `${id}-proof.txt`);
    const { text, steps } = await run(
      id,
      `Create the file ${target} containing the word hi. If you are not able to, reply with the single word CANNOT.`,
    );
    expect(existsSync(target)).toBe(false);
    console.log(`${id} write attempt`, { steps, text: text.slice(0, 300) });
  });

  it('stops quickly when cancelled mid-reply', async () => {
    const { stopMs, text } = await run(
      id,
      'Write a 400 word story about a lighthouse keeper.',
      [],
      (outputs) => outputs.some((output) => output.kind === 'text_delta'),
    );
    expect(text.length).toBeGreaterThan(0);
    expect(stopMs).not.toBeNull();
    expect(stopMs!).toBeLessThan(6_000);
  });
});
