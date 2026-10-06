import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InvolvementLevel } from '@spark-outpost/contracts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { saveConnection as saveTicketConnection } from '../src/tickets/connections.ts';
import { LINEAR_KEY } from './fake-linear.ts';
import { connectSlack, slackDeps, startSlackStub, type SlackStub } from './slack-support.ts';
import {
  chatAtLevel,
  recordedHooks,
  startSparkTools,
  type RecordedHooks,
  type SparkToolsHarness,
} from './spark-mcp-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';
import { startTicketStubs, type TicketStubs } from './ticket-support.ts';

let t: TestDb;
let secrets: SecretStore;
let tickets: TicketStubs;
let slack: SlackStub;
let recorded: RecordedHooks;
let tools: SparkToolsHarness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  secrets = memorySecretStore();
  tickets = await startTicketStubs();
  slack = await startSlackStub();
  await saveTicketConnection(
    { db: t.db, workspaceId: t.workspaceId, secrets, fetch, linearApiUrl: tickets.linearUrl },
    { source: 'linear', apiKey: LINEAR_KEY },
  );
  await connectSlack(slackDeps(t, slack, secrets));
  recorded = recordedHooks();
});

afterEach(async () => {
  recorded.stop();
  await tools?.close();
  tools = null;
  await slack.close();
  await tickets.close();
  await t.cleanup();
});

const LEVELS: readonly InvolvementLevel[] = ['hands-off', 'full-auto'];

const MODES = [
  ['plan', 'waiting_for_user'],
  ['default', 'waiting_for_user'],
  ['acceptEdits', 'waiting_for_user'],
  ['auto', 'done'],
  ['bypassPermissions', 'done'],
] as const;

const ACTIONS = [
  ['spark_create_ticket', { project: 'ENG', title: 'Crash on save' }],
  ['spark_slack_post', { channel: 'eng', text: 'Build is green' }],
  [
    'spark_add_mcp_server',
    { name: 'files', transport: 'stdio', command: 'npx', args: ['-y', 'files-server'] },
  ],
] as const;

const CASES = LEVELS.flatMap((level) =>
  MODES.flatMap(([mode, outcome]) =>
    ACTIONS.map(([tool, args]) => ({ level, mode, tool, args, outcome })),
  ),
);

async function chatIn(level: InvolvementLevel, mode: string): Promise<void> {
  const { conversationId, runId } = await startChat(t, 'Look into the crash');
  await chatAtLevel(t, conversationId, level);
  await t.db.query(`UPDATE runs SET provider = 'claude', used_mode = $2 WHERE id = $1`, [
    runId,
    mode,
  ]);
  tools = await startSparkTools(
    t,
    { conversationId, runId, actions: recorded.hooks },
    { secrets, linearApiUrl: tickets.linearUrl, slackApiUrl: slack.apiUrl },
  );
}

describe('a Spark action follows the agent mode, never the autonomy level', () => {
  it.each(CASES)('$tool at $level in $mode: $outcome', async (entry) => {
    await chatIn(entry.level, entry.mode);
    const result = (await tools!.call(entry.tool, entry.args)).json<{ outcome: string }>();
    expect(result.outcome).toBe(entry.outcome);
  });
});
