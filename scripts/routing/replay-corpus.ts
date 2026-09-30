import type { AdvisorCandidate } from '../../apps/server/src/advisor/advice.ts';
import { REQUESTS } from '../codescan/requests.ts';
import { TASKS } from '../bench/tasks.ts';
import { SCENARIOS } from '../e2e-live/scenarios.ts';
import { SESSIONS } from '../e2e-live/dev-day/sessions.ts';

export interface ReplayItem {
  id: string;
  request: string;
  followUp: boolean;
}

export function replayCorpus(): ReplayItem[] {
  const items: ReplayItem[] = [];
  for (const [repo, requests] of Object.entries(REQUESTS)) {
    requests.forEach((request, index) => {
      items.push({ id: `scan:${repo}:${index}`, request, followUp: false });
    });
  }
  for (const task of TASKS) {
    items.push({ id: `bench:${task.id}`, request: task.prompt, followUp: false });
  }
  for (const scenario of SCENARIOS) {
    scenario.turns.forEach((request, index) => {
      items.push({ id: `e2e:${scenario.id}:${index}`, request, followUp: index > 0 });
    });
  }
  for (const session of SESSIONS) {
    session.turns.forEach((turn, index) => {
      items.push({ id: `day:${session.id}:${index}`, request: turn.text, followUp: index > 0 });
    });
  }
  return items;
}

export interface ReplayChat {
  name: string;
  provider: string;
  model: string;
  label: string;
}

export const replayChats: readonly ReplayChat[] = [
  { name: 'claude-sonnet', provider: 'claude', model: 'sonnet', label: 'Sonnet 5' },
  { name: 'claude-opus', provider: 'claude', model: 'opus[1m]', label: 'Opus 5.5' },
  { name: 'codex-sol', provider: 'codex', model: 'gpt-6-sol', label: '6 Sol' },
];

const efforts = ['low', 'medium', 'high'].map((id) => ({ id, label: id, description: null }));

export const replayCandidates: AdvisorCandidate[] = [
  {
    provider: 'claude',
    name: 'Claude',
    models: [
      { id: 'haiku', label: 'Haiku 4.5', description: null },
      { id: 'sonnet', label: 'Sonnet 5', description: null },
      { id: 'opus[1m]', label: 'Opus 5.5', description: null },
      { id: 'claude-fable-5-1[1m]', label: 'Fable 5.1', description: null },
    ],
    efforts,
  },
  {
    provider: 'codex',
    name: 'Codex',
    models: [
      { id: 'gpt-6-luna', label: '6 Luna', description: null },
      { id: 'gpt-6-sol', label: '6 Sol', description: null },
      { id: 'gpt-6-astra', label: '6 Astra', description: null },
    ],
    efforts,
  },
];
