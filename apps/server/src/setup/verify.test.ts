import { describe, expect, it } from 'vitest';
import { catalogEntry } from '../providers/catalog.ts';
import type { RunCommand } from './command.ts';
import { verifyApiKeyWithCli, type ApiEndpoints, type VerifyStep } from './verify.ts';

const missing: RunCommand = async () => ({ code: 1, stdout: '', stderr: '' });

function endpoints(onFetch: () => void): ApiEndpoints {
  return {
    anthropicBaseUrl: 'https://anthropic.test',
    openaiBaseUrl: 'https://openai.test',
    typesafeBaseUrl: 'https://typesafe.test',
    zaiBaseUrl: 'https://zai.test',
    fetch: async () => {
      onFetch();
      return new Response('{}', { status: 500 });
    },
  };
}

async function steps(verification: AsyncGenerator<VerifyStep, unknown>) {
  const seen: VerifyStep[] = [];
  let next = await verification.next();
  while (!next.done) {
    seen.push(next.value);
    next = await verification.next();
  }
  return { seen, result: next.value };
}

describe('API key verification needs the agent CLI', () => {
  it.each([
    [
      'claude',
      'API key mode also needs the `claude` CLI installed.',
      'npm i -g @anthropic-ai/claude-code',
    ],
    ['codex', 'API key mode also needs the `codex` CLI installed.', 'npm i -g @openai/codex'],
    [
      'zai',
      'Z.ai (GLM) also needs the `claude` CLI installed.',
      'npm i -g @anthropic-ai/claude-code',
    ],
  ] as const)(
    'stops %s before any network call when the CLI is missing',
    async (id, why, install) => {
      let fetched = false;
      const { seen, result } = await steps(
        verifyApiKeyWithCli(
          catalogEntry(id),
          'key',
          endpoints(() => (fetched = true)),
          missing,
          null,
        ),
      );
      expect(result).toBeNull();
      expect(fetched).toBe(false);
      expect(seen.at(-1)).toEqual({
        type: 'step_failed',
        label: expect.stringContaining(why),
        code: 'cli_missing',
      });
      expect(seen.at(-1)).toMatchObject({ label: expect.stringContaining(install) });
    },
  );
});
