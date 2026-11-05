import type { ModeChoice } from '../tasks/types.ts';

export const PROVIDERS = ['claude', 'codex', 'zai'] as const;
export type Provider = (typeof PROVIDERS)[number];

export interface ProviderSetup {
  name: string;
  method: 'cli' | 'api_key';
  model: string;
  modes: Record<ModeChoice, string>;
  signIn: string;
}

export const PROVIDER_SETUPS: Record<Provider, ProviderSetup> = {
  claude: {
    name: 'Claude',
    method: 'cli',
    model: 'sonnet',
    modes: { auto: 'auto', ask: 'default' },
    signIn: 'the Claude CLI login',
  },
  codex: {
    name: 'Codex',
    method: 'cli',
    model: 'gpt-6-sol',
    modes: { auto: 'agent', ask: 'ask-every-action' },
    signIn: 'the Codex CLI login',
  },
  zai: {
    name: 'Z.ai (GLM)',
    method: 'api_key',
    model: 'opus',
    modes: { auto: 'auto', ask: 'default' },
    signIn: "the Z.ai key Spark stored, read by Spark's own code",
  },
};

export function providerNamed(value: string): Provider {
  if (!PROVIDERS.includes(value as Provider)) {
    throw new Error(`Unknown provider ${value}. Use ${PROVIDERS.join(', ')}.`);
  }
  return value as Provider;
}
