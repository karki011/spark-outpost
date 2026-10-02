import { describe, expect, it } from 'vitest';
import type { ProviderConnection, ProviderIssue, ProviderSetup } from '@spark-outpost/contracts';
import { tileStatus } from './tile-status.ts';

const when = () => '2 min ago';

const codex: ProviderSetup = {
  id: 'codex',
  name: 'Codex',
  maker: 'OpenAI',
  cli: 'codex',
  keyPrefix: 'sk-',
  keyHint: 'Paste an OpenAI key',
  keyLink: null,
  methods: ['cli', 'api_key'],
  connection: null,
  note: null,
  installCommand: 'npm i -g @openai/codex',
  efforts: [],
  defaultEffort: 'medium',
};

const connection: ProviderConnection = {
  method: 'cli',
  detail: 'codex 1.0',
  summary: null,
  lastTest: null,
  models: [],
  model: null,
  permission: 'ask',
  agentMode: null,
  effort: null,
  verifiedAt: '2026-10-02T10:00:00Z',
};

const issue = (kind: ProviderIssue['kind']): ProviderIssue => ({
  provider: 'codex',
  kind,
  message: 'x',
  at: '2026-10-02T10:00:00Z',
});

describe('tileStatus', () => {
  it('says how to connect when nothing is set up', () => {
    expect(tileStatus(codex, null, null, when)).toEqual({
      tone: 'off',
      label: 'Not set up',
      hint: 'Connect with the codex CLI or an API key',
    });
  });

  it('names the step a failed verify stopped at', () => {
    expect(tileStatus(codex, null, { code: 'cli_missing', label: 'x' }, when)).toEqual({
      tone: 'warn',
      label: 'CLI not installed',
      hint: 'Install it with npm i -g @openai/codex',
    });
    expect(tileStatus(codex, null, { code: 'not_logged_in', label: 'x' }, when).label).toBe(
      'Needs sign-in',
    );
    expect(tileStatus(codex, null, { code: null, label: 'OpenAI said 500' }, when)).toEqual({
      tone: 'bad',
      label: 'Error',
      hint: 'OpenAI said 500',
    });
  });

  it('shows the method and nudges a first test once connected', () => {
    expect(tileStatus({ ...codex, connection }, null, null, when)).toEqual({
      tone: 'ok',
      label: 'Connected · Local CLI',
      hint: 'Send a test message to check it',
    });
  });

  it('ignores an old verify failure once connected and reports the last test', () => {
    const tested = {
      ...connection,
      method: 'api_key' as const,
      lastTest: { ok: true, message: 'ok', testedAt: '2026-10-02T10:00:00Z' },
    };
    expect(
      tileStatus({ ...codex, connection: tested }, null, { code: null, label: 'x' }, when),
    ).toEqual({ tone: 'ok', label: 'Connected · API key', hint: 'Last test passed · 2 min ago' });
  });

  it('turns provider issues into sign-in or error chips', () => {
    expect(tileStatus({ ...codex, connection }, issue('auth'), null, when)).toEqual({
      tone: 'warn',
      label: 'Needs sign-in',
      hint: 'Sign-in failed · 2 min ago',
    });
    expect(tileStatus({ ...codex, connection }, issue('rate_limit'), null, when)).toEqual({
      tone: 'bad',
      label: 'Error',
      hint: 'Rate limited · 2 min ago',
    });
  });
});
