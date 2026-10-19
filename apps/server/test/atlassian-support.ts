import type { Approval } from '@spark-outpost/contracts';
import type { RunObservations, SentOutNote } from '../src/observations/run-observations.ts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { saveConnection } from '../src/tickets/connections.ts';
import { JIRA_EMAIL, JIRA_TOKEN } from './fake-jira.ts';
import {
  recordedHooks,
  startSparkTools,
  type RecordedHooks,
  type SparkToolsHarness,
} from './spark-mcp-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';
import { startTicketStubs, type TicketStubs } from './ticket-support.ts';

export interface AtlassianHarness {
  t: TestDb;
  stubs: TicketStubs;
  secrets: SecretStore;
  recorded: RecordedHooks;
  tools: SparkToolsHarness;
  sent: SentOutNote[];
  recordedObservations: string[];
}

function watchingObservations(
  sent: SentOutNote[],
  seen: string[],
  readBefore: readonly string[],
): RunObservations {
  return {
    record: (observation) => void seen.push(observation.label),
    labels: async () => [...readBefore],
    egressAsked: () => undefined,
    sentOut: (note) => void sent.push(note),
    crossed: async () => undefined,
    later: () => undefined,
    settled: async () => undefined,
  };
}

export async function startAtlassian(
  message: string,
  mode: string | null,
  readBefore: readonly string[] = [],
): Promise<AtlassianHarness> {
  const t = await createTestDb();
  const secrets = memorySecretStore();
  const stubs = await startTicketStubs();
  await saveConnection(
    { db: t.db, workspaceId: t.workspaceId, secrets, fetch },
    { source: 'jira', siteUrl: stubs.jiraUrl, email: JIRA_EMAIL, apiToken: JIRA_TOKEN },
  );
  const { conversationId, runId } = await startChat(t, message);
  if (mode) {
    await t.db.query(`UPDATE runs SET provider = 'claude', used_mode = $2 WHERE id = $1`, [
      runId,
      mode,
    ]);
  }
  const recorded = recordedHooks();
  const sent: SentOutNote[] = [];
  const recordedObservations: string[] = [];
  const tools = await startSparkTools(
    t,
    {
      conversationId,
      runId,
      actions: recorded.hooks,
      observations: watchingObservations(sent, recordedObservations, readBefore),
    },
    { secrets },
  );
  return { t, stubs, secrets, recorded, tools, sent, recordedObservations };
}

export async function stopAtlassian(harness: AtlassianHarness): Promise<void> {
  harness.recorded.stop();
  await harness.tools.close();
  await harness.stubs.close();
  await harness.t.cleanup();
}

export async function sparkCards(t: TestDb): Promise<Approval['status'][]> {
  const { rows } = await t.db.query<{ status: Approval['status'] }>(
    `SELECT status FROM approvals WHERE kind = 'spark_action' ORDER BY created_at`,
  );
  return rows.map((row) => row.status);
}

export function evidence(text: string): Record<string, unknown> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
}
