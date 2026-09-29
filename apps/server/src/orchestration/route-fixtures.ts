import type { AdvisorCandidate } from '../advisor/advice.ts';
import type { RouteContext } from './routing.ts';

const efforts = ['low', 'medium', 'high'].map((id) => ({ id, label: id, description: null }));
export const candidates: AdvisorCandidate[] = [
  {
    provider: 'claude',
    name: 'Claude',
    models: [
      { id: 'haiku', label: 'Haiku 4.5', description: null },
      { id: 'sonnet', label: 'Sonnet 5', description: null },
      { id: 'opus[1m]', label: 'Opus 5.5', description: null },
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

export const context = (routing: 'auto' | 'pinned'): RouteContext => ({
  routing,
  chat: { provider: 'claude', model: 'sonnet', modelLabel: null, effort: 'medium' },
  providerEffort: null,
  candidates,
});

export const plainFacts = { trivial: false, destructive: false };
