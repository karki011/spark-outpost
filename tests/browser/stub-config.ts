import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const credentials = path.resolve(import.meta.dirname, '../../.local/credentials.env');
if (!process.env.TEST_DATABASE_URL && existsSync(credentials)) process.loadEnvFile(credentials);

function portSlot(): number {
  if (process.env.SPARK_TEST_PORT_SLOT) return Number(process.env.SPARK_TEST_PORT_SLOT);
  const database = new URL(
    process.env.TEST_DATABASE_URL ?? 'postgres://x/spark_outpost_test',
  ).pathname.slice(1);
  if (database === 'spark_outpost_test') return 0;
  return 1 + (createHash('sha256').update(database).digest().readUInt16BE(0) % 400);
}

export const slot = portSlot();
const base = slot === 0 ? null : 20_000 + slot * 10;

function slotDatabaseUrl(): string | null {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || slot === 0) return url ?? null;
  const parsed = new URL(url);
  if (parsed.pathname.slice(1) !== 'spark_outpost_test') return url;
  parsed.pathname = `/spark_outpost_test_slot${slot}`;
  return parsed.toString();
}

export const TEST_DATABASE_URL = slotDatabaseUrl();

export const SERVER_LOG_DIR = path.join(os.tmpdir(), `spark-outpost-server-logs-${slot}`);

export const STUB_PORT = base ?? 4399;
export const API_PORT = base === null ? 4319 : base + 1;
export const WEB_PORT = base === null ? 5174 : base + 2;
export const REJECTED_KEY_MARKER = 'rejected';
export const FAKE_CODEX_STATE = path.join(
  os.tmpdir(),
  slot === 0 ? 'spark-outpost-fake-codex-logged-in' : `spark-outpost-fake-codex-logged-in-${slot}`,
);

export const FAKE_CLAUDE_BIN = path.join(
  os.tmpdir(),
  slot === 0 ? 'spark-outpost-fake-claude-bin' : `spark-outpost-fake-claude-bin-${slot}`,
);

export const FAKE_GH_STATE = path.join(
  os.tmpdir(),
  slot === 0 ? 'spark-outpost-fake-gh-login' : `spark-outpost-fake-gh-login-${slot}`,
);

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

export const FAKE_ACP_MODES: [string, string, string | null, string | null][] = [
  ['read-only', 'Ask first', null, null],
  ['ask-every-action', 'Ask every time', null, null],
  ['agent', 'Agent', null, null],
  ['yolo', 'Yolo', 'Custom mode from the fake agent', 'full_access'],
];

export const MAP_ROOT_PREFIX = path.join(realpathSync(os.tmpdir()), 'spark-map-real-');
