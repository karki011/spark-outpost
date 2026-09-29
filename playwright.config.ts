import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { API_TOKEN_ENV } from './packages/contracts/src/api-token.ts';
import {
  API_PORT,
  FAKE_ACP_MODELS,
  FAKE_ACP_MODES,
  FAKE_CODEX_STATE,
  FAKE_GH_STATE,
  MCP_SCAN_HOME,
  slot,
  STUB_PORT,
  WEB_PORT,
} from './tests/browser/stub-config.ts';

if (existsSync('.local/credentials.env')) process.loadEnvFile('.local/credentials.env');

const STUB_URL = `http://127.0.0.1:${STUB_PORT}`;
const apiToken = randomBytes(32).toString('base64url');

const serverEnv = {
  PATH: `${path.resolve('tests/browser/bin')}:/usr/bin:/bin`,
  CLI_LOOKUP_LOGIN_SHELL: 'false',
  FAKE_CODEX_STATE,
  FAKE_GH_STATE,
  MCP_SCAN_HOME,
  FAKE_GH_NODE: process.execPath,
  FAKE_GH_API: `${STUB_URL}/github`,
  GITHUB_API_URL: `${STUB_URL}/github`,
  SHELL: '/bin/sh',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
  API_PORT: String(API_PORT),
  ALLOWED_ORIGINS: `http://127.0.0.1:${WEB_PORT}`,
  SECRET_STORE: 'memory',
  MEMORY_SECRETS: JSON.stringify({ jev: 'browser-test-jev-key', zai: 'browser-test-zai-key' }),
  AGENT_RUNTIME: 'fake',
  OUTCOME_SAMPLE_RATE: '0',
  FAKE_ACP_AGENT: path.resolve('apps/server/test/fake-acp-agent.ts'),
  FAKE_ACP_MODELS: JSON.stringify(FAKE_ACP_MODELS),
  FAKE_ACP_MODES: JSON.stringify(FAKE_ACP_MODES),
  FAKE_ACP_FAST: '1',
  ANTHROPIC_BASE_URL: `${STUB_URL}/anthropic`,
  OPENAI_BASE_URL: `${STUB_URL}/openai`,
  TYPESAFE_BASE_URL: `${STUB_URL}/typesafe`,
  ZAI_BASE_URL: `${STUB_URL}/zai`,
};

const node = JSON.stringify(process.execPath);
const serverCommand = (entry: string) => `${node} --import tsx ${entry}`;
const shutdown = { signal: 'SIGTERM', timeout: 5_000 } as const;

export default defineConfig({
  testDir: 'tests/browser',
  globalSetup: './tests/browser/single-worker.ts',
  outputDir: slot === 0 ? 'test-results' : `test-results/slot-${slot}`,
  timeout: 30_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `${node} --import tsx tests/browser/provider-stub.ts`,
      url: `${STUB_URL}/health`,
      reuseExistingServer: false,
      gracefulShutdown: shutdown,
    },
    {
      command: `${serverCommand('src/persistence/migrate-cli.ts')} && ${serverCommand('src/api/main.ts')}`,
      cwd: 'apps/server',
      env: { ...serverEnv, [API_TOKEN_ENV]: apiToken },
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      gracefulShutdown: shutdown,
    },
    {
      command: serverCommand('src/workflow/main.ts'),
      cwd: 'apps/server',
      env: serverEnv,
      wait: { stdout: /Worker running/ },
      reuseExistingServer: false,
      timeout: 60_000,
      gracefulShutdown: shutdown,
    },
    {
      command: `${node} node_modules/vite/bin/vite.js`,
      cwd: 'apps/web',
      env: {
        SPARK_WEB_PORT: String(WEB_PORT),
        SPARK_API_PORT: String(API_PORT),
        [API_TOKEN_ENV]: apiToken,
      },
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      gracefulShutdown: shutdown,
    },
  ],
});
