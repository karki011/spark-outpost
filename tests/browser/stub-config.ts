import os from 'node:os';
import path from 'node:path';

export const STUB_PORT = 4399;
export const REJECTED_KEY_MARKER = 'rejected';
export const FAKE_CODEX_STATE = path.join(os.tmpdir(), 'spark-outpost-fake-codex-logged-in');

export const CREW_CATALOG = {
  claude: [
    { id: 'haiku', label: 'Haiku 4.5', description: 'Fastest for quick answers' },
    { id: 'sonnet', label: 'Sonnet 5', description: 'Efficient for routine tasks' },
    { id: 'opus[1m]', label: 'Opus 5.5', description: 'Best for complex tasks' },
  ],
  codex: [
    { id: 'gpt-6-luna', label: '6 Luna', description: 'Fast' },
    { id: 'gpt-6-sol', label: '6 Sol', description: 'Workhorse' },
    { id: 'gpt-6-astra', label: '6 Astra', description: 'Frontier' },
  ],
};

export const FAKE_ACP_MODELS: [string, string][] = [
  ...CREW_CATALOG.claude,
  ...CREW_CATALOG.codex,
  { id: 'fake-fast', label: 'Fake Fast' },
  { id: 'fake-deep', label: 'Fake Deep' },
].map((model) => [model.id, model.label]);
