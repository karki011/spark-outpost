import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { APP_CLIENT_ID, APP_SLUG } from './apps/server/test/fake-github-app.ts';
import { SLACK_CLIENT_ID } from './apps/server/test/fake-slack-oauth.ts';
import { LINEAR_KEY } from './apps/server/test/fake-linear.ts';
import { SLACK_BOT_TOKEN, SLACK_USER_TOKEN } from './apps/server/test/fake-slack.ts';
import { API_TOKEN_ENV, API_TOKEN_HEADER } from './packages/contracts/src/api-token.ts';
import {
  API_PORT,
  API_RESTART_FLAG,
  APP_ORIGIN,
  CLONE_TEST_ROOT,
  FAKE_ACP_MODELS,
  FAKE_CLAUDE_BIN,
  FAKE_ACP_MODES,
  FAKE_CALENDAR_STATE,
  FAKE_CODEX_STATE,
  FAKE_GH_STATE,
  FAKE_TAILSCALE_STATE,
  MAP_ROOT_PREFIX,
  PACKAGED,
  SERVER_LOG_DIR,
  SIGN_IN_FIXTURE,
  slot,
  STUB_PORT,
  TEST_DATABASE_URL,
  TEST_TMPDIR,
  WEB_BUILD_ENV,
  WEB_PORT,
} from './tests/browser/stub-config.ts';
import { FRESH_TEST_TMPDIR } from './tests/browser/test-tmpdir.ts';

if (existsSync('.local/credentials.env')) process.loadEnvFile('.local/credentials.env');
delete process.env.BACKUP_DIR;
process.env.TMPDIR = TEST_TMPDIR;

const STUB_URL = `http://127.0.0.1:${STUB_PORT}`;
process.env.SPARK_BROWSER_API_TOKEN ??= randomBytes(32).toString('base64url');
const apiToken = process.env.SPARK_BROWSER_API_TOKEN;

const serverEnv = {
  PATH: `${path.resolve('tests/browser/bin')}:${FAKE_CLAUDE_BIN}:/usr/bin:/bin`,
  CLI_LOOKUP_LOGIN_SHELL: 'false',
  FAKE_CODEX_STATE,
  FAKE_GH_STATE,
  FAKE_TAILSCALE_STATE,
  SPARK_FAKE_CALENDAR_STATE: FAKE_CALENDAR_STATE,
  FAKE_GH_NODE: process.execPath,
  FAKE_GH_API: `${STUB_URL}/github`,
  GITHUB_API_URL: `${STUB_URL}/github`,
  GITHUB_LOGIN_URL: `${STUB_URL}/github`,
  SPARK_GITHUB_APP_CLIENT_ID: APP_CLIENT_ID,
  SPARK_GITHUB_APP_SLUG: APP_SLUG,
  SHELL: '/bin/sh',
  TMPDIR: TEST_TMPDIR,
  DATABASE_URL: TEST_DATABASE_URL ?? '',
  API_PORT: String(API_PORT),
  ALLOWED_ORIGINS: APP_ORIGIN,
  SECRET_STORE: 'memory',
  MEMORY_SECRETS: JSON.stringify({
    jev: 'browser-test-jev-key',
    zai: 'browser-test-zai-key',
    'ticket:linear': LINEAR_KEY,
    'slack:bot': SLACK_BOT_TOKEN,
    'slack:user': SLACK_USER_TOKEN,
    [`signin:${SIGN_IN_FIXTURE.id}`]: JSON.stringify({
      username: SIGN_IN_FIXTURE.username,
      password: SIGN_IN_FIXTURE.password,
    }),
  }),
  AGENT_RUNTIME: 'fake',
  OUTCOME_SAMPLE_RATE: '0',
  MORNING_BRIEF: 'false',
  MAP_ROOT_PREFIX,
  CLONE_TEST_ROOT,
  PAIRING_TEST_ATTEMPTS_PER_MINUTE: '1000',
  LINEAR_API_URL: `${STUB_URL}/linear/graphql`,
  SLACK_API_URL: `${STUB_URL}/slack/api`,
  SPARK_SLACK_CLIENT_ID: SLACK_CLIENT_ID,
  FAKE_ACP_AGENT: path.resolve('apps/server/test/fake-acp-agent.ts'),
  FAKE_ACP_MODELS: JSON.stringify(FAKE_ACP_MODELS),
  FAKE_ACP_MODES: JSON.stringify(FAKE_ACP_MODES),
  FAKE_ACP_FAST: '1',
  FAKE_ACP_MCP_CAPABILITIES: JSON.stringify({ http: true, sse: false }),
  ANTHROPIC_BASE_URL: `${STUB_URL}/anthropic`,
  OPENAI_BASE_URL: `${STUB_URL}/openai`,
  TYPESAFE_BASE_URL: `${STUB_URL}/typesafe`,
  ZAI_BASE_URL: `${STUB_URL}/zai`,
};

const node = JSON.stringify(process.execPath);
const serverCommand = (entry: string) => `${node} --import tsx ${entry}`;
const workerCommand =
  process.env.SPARK_FAKE_BROWSER === '1'
    ? `${node} --import tsx --import ../../tests/browser/fake-browser-host.ts src/workflow/main.ts`
    : serverCommand('src/workflow/main.ts');
const apiCommand =
  process.env.SPARK_FAKE_CALENDAR === '1'
    ? `${node} --import tsx --import ../../tests/browser/fake-calendar-host.ts src/api/main.ts`
    : serverCommand('src/api/main.ts');
const logged = (command: string, name: string) =>
  `mkdir -p ${JSON.stringify(SERVER_LOG_DIR)} && { ${command}; } 2>&1 | tee -a ${JSON.stringify(path.join(SERVER_LOG_DIR, `${name}.log`))}`;
const restartFlag = JSON.stringify(API_RESTART_FLAG);
const restartable = (command: string) =>
  `while :; do ${command}; [ -e ${restartFlag} ] || break; rm -f ${restartFlag}; done`;
const shutdown = { signal: 'SIGTERM', timeout: 5_000 } as const;
const buildsWeb = PACKAGED || Boolean(process.env.SPARK_WEB_BUILD);
const viteBuild = `${node} node_modules/vite/bin/vite.js build`;
const packagedBuild = PACKAGED ? `(cd ../web && ${viteBuild}) && ` : '';

const vitePreview = `${node} node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${WEB_PORT} --strictPort`;
const builtWebCommand = process.env.SPARK_WEB_PREBUILT
  ? vitePreview
  : `${viteBuild} && ${vitePreview}`;

const viteServer = {
  command: process.env.SPARK_WEB_BUILD ? builtWebCommand : `${node} node_modules/vite/bin/vite.js`,
  cwd: 'apps/web',
  env: {
    ...WEB_BUILD_ENV,
    SPARK_WEB_PORT: String(WEB_PORT),
    SPARK_API_PORT: String(API_PORT),
    [API_TOKEN_ENV]: apiToken,
  },
  url: `http://127.0.0.1:${WEB_PORT}`,
  reuseExistingServer: false,
  timeout: buildsWeb ? 300_000 : 60_000,
  gracefulShutdown: shutdown,
};

export default defineConfig({
  testDir: 'tests/browser',
  globalSetup: './tests/browser/single-worker.ts',
  globalTeardown: ['./tests/browser/stop-terminals.ts', './tests/browser/test-tmpdir.ts'],
  outputDir: slot === 0 ? 'test-results' : `test-results/slot-${slot}`,
  timeout: 30_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: APP_ORIGIN,
    trace: 'retain-on-failure',
    ...(PACKAGED ? { extraHTTPHeaders: { [API_TOKEN_HEADER]: apiToken } } : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `${FRESH_TEST_TMPDIR} && ${node} --import tsx tests/browser/provider-stub.ts`,
      url: `${STUB_URL}/health`,
      reuseExistingServer: false,
      gracefulShutdown: shutdown,
    },
    {
      command: `${packagedBuild}${node} --import tsx ../../tests/browser/ensure-database.ts && ${serverCommand('src/persistence/migrate-cli.ts')} && ${logged(restartable(apiCommand), 'api')}`,
      cwd: 'apps/server',
      env: {
        ...serverEnv,
        ...(PACKAGED ? { ...WEB_BUILD_ENV, WEB_ROOT: path.resolve('apps/web/dist') } : {}),
        [API_TOKEN_ENV]: apiToken,
        SPARK_TEST_PORT_SLOT: String(slot),
        TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      },
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: PACKAGED ? 300_000 : 60_000,
      gracefulShutdown: shutdown,
    },
    {
      command: logged(workerCommand, 'worker'),
      cwd: 'apps/server',
      env: serverEnv,
      wait: { stdout: /Worker running/ },
      reuseExistingServer: false,
      timeout: 60_000,
      gracefulShutdown: shutdown,
    },
    ...(PACKAGED ? [] : [viteServer]),
  ],
});
