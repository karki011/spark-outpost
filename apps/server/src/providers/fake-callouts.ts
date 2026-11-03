import { setTimeout as delay } from 'node:timers/promises';
import type { ProviderOutput, ProviderTurn } from './provider.ts';

const FAKE_CALLOUTS_TRIGGER = '#callouts';
const STEP_MS = 40;
const LIVE_MS = 2_500;

export const FAKE_CALLOUTS_REPLY = 'The pricing page lists three plans.';

interface FakeStep {
  name: string;
  toolKind: string;
  toolName: string;
  path?: string;
  callout?: string;
  liveMs?: number;
}

const read = (file: string): FakeStep => ({
  name: `Read \`${file}\``,
  toolKind: 'read',
  toolName: 'Read',
  path: `/repo/${file}`,
});

const FAKE_CALLOUT_STEPS: readonly FakeStep[] = [
  read('pricing.ts'),
  read('plans.ts'),
  {
    name: 'Opening a page in the browser',
    toolKind: 'other',
    toolName: 'mcp__spark__spark_browser_open',
    callout: 'www.cloudzero.com',
    liveMs: LIVE_MS,
  },
  {
    name: 'Reading a page',
    toolKind: 'other',
    toolName: 'mcp__spark__spark_browser_read',
  },
  {
    name: 'Searched the web',
    toolKind: 'fetch',
    toolName: 'WebSearch',
    callout: 'cloud cost pricing tiers',
  },
  read('README.md'),
  read('CHANGELOG.md'),
  {
    name: 'Making an artifact',
    toolKind: 'other',
    toolName: 'mcp__spark__spark_artifact',
    callout: 'publish Pricing summary',
  },
  {
    name: 'Acting in a Mac app',
    toolKind: 'other',
    toolName: 'mcp__spark__spark_mac_act',
    callout: 'menu Notes › File › Save',
  },
];

export function wantsCallouts(prompt: string): boolean {
  return prompt.includes(FAKE_CALLOUTS_TRIGGER);
}

function stepOutput(kind: 'step_started' | 'step_finished', step: FakeStep): ProviderOutput {
  const { name, toolKind, toolName, path, callout } = step;
  return {
    kind,
    name,
    tool: true,
    toolKind,
    toolName,
    ...(path ? { path } : {}),
    ...(callout ? { callout } : {}),
  };
}

export async function* fakeCalloutTurn(turn: ProviderTurn): AsyncGenerator<ProviderOutput> {
  for (const step of FAKE_CALLOUT_STEPS) {
    yield stepOutput('step_started', step);
    await delay(step.liveMs ?? STEP_MS, undefined, { signal: turn.signal });
    yield stepOutput('step_finished', step);
  }
  yield { kind: 'text_delta', delta: FAKE_CALLOUTS_REPLY };
}
