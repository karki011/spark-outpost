import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FAKE_CLAUDE_MODES } from '../../apps/server/src/providers/fake.ts';

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

export function slotPorts(forSlot: number): { stub: number; api: number; web: number } {
  if (forSlot === 0) return { stub: 4399, api: 4319, web: 5174 };
  const base = 20_000 + forSlot * 10;
  return { stub: base, api: base + 1, web: base + 2 };
}

export function slotDatabaseUrl(url: string, forSlot: number): string {
  if (forSlot === 0) return url;
  const parsed = new URL(url);
  if (parsed.pathname.slice(1) !== 'spark_outpost_test') return url;
  parsed.pathname = `/spark_outpost_test_slot${forSlot}`;
  return parsed.toString();
}

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
  ? slotDatabaseUrl(process.env.TEST_DATABASE_URL, slot)
  : null;

export const SERVER_LOG_DIR = path.join(os.tmpdir(), `spark-outpost-server-logs-${slot}`);
export const API_RESTART_FLAG = path.join(SERVER_LOG_DIR, 'restart-api');

const ports = slotPorts(slot);
export const STUB_PORT = ports.stub;
export const API_PORT = ports.api;
export const WEB_PORT = ports.web;
export const WEB_BUILD_ENV = { VITE_SPARK_FEEDBACK_EMAIL: 'beta-feedback@example.test' };
export const PACKAGED = process.env.SPARK_PACKAGED === '1';
export const APP_ORIGIN = `http://127.0.0.1:${PACKAGED ? API_PORT : WEB_PORT}`;
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

export const FAKE_CALENDAR_STATE = path.join(
  os.tmpdir(),
  slot === 0 ? 'spark-outpost-fake-calendar.json' : `spark-outpost-fake-calendar-${slot}.json`,
);
export const FAKE_TAILSCALE_STATE = path.join(
  os.tmpdir(),
  slot === 0 ? 'spark-outpost-fake-tailscale.json' : `spark-outpost-fake-tailscale-${slot}.json`,
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

type FakeAcpMode = [string, string, string | null, string | null];

const YOLO: FakeAcpMode = ['yolo', 'Yolo', 'Custom mode from the fake agent', 'full_access'];

const CLAUDE_ACP_MODES: FakeAcpMode[] = [
  ...FAKE_CLAUDE_MODES.map((mode): FakeAcpMode => [
    mode.id,
    mode.label,
    mode.description,
    mode.kind,
  ]),
  YOLO,
];

export const FAKE_ACP_MODES: Record<string, FakeAcpMode[]> = {
  claude: CLAUDE_ACP_MODES,
  zai: CLAUDE_ACP_MODES,
  codex: [
    ['read-only', 'Ask first', null, null],
    ['ask-every-action', 'Ask every time', null, null],
    ['agent', 'Agent', null, null],
    YOLO,
  ],
};

export const MAP_ROOT_PREFIX = path.join(realpathSync(os.tmpdir()), 'spark-map-real-');
export const CLONE_TEST_ROOT = path.join(realpathSync(os.tmpdir()), `spark-clone-home-${slot}`);

export const SIGN_IN_FIXTURE = {
  id: '0199b1c2-7a10-7c3e-9f41-5d2e8a6b4c01',
  username: 'vault-user@example.test',
  password: 'vault-Passw0rd!-spec 5',
};
