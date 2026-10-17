import { afterEach, describe, expect, it } from 'vitest';
import { AGENT_COMPACTED_NOTE } from '../src/compaction/before-turn.ts';
import { IDENTIFIERS_TITLE } from '../src/compaction/anchors.ts';
import { chatIdentifiers } from '../src/compaction/identifiers.ts';
import {
  compactionsOf,
  newChat,
  promptsOf,
  say,
  sessionsOf,
  startCompactionHarness,
  type CompactionHarness,
} from './compaction-support.ts';
import { FAKE_ACP_COMPACT_REPLY } from './fake-acp-context.ts';

const SHA = '9fceb02d0ae598e95dc970b74767f19372d61af8';
const PR = '#4127';
const BRANCH = 'spark/export-csv';
const ERROR = "TypeError: Cannot read properties of undefined (reading 'cents')";
const TICKET = 'SPARK-318';
const IDENTIFIERS_HEADING = `## ${IDENTIFIERS_TITLE}`;

let h: CompactionHarness;

afterEach(async () => {
  await h.stop();
});

async function addToolResult(runId: string, content: string): Promise<void> {
  await h.t.db.query(
    `INSERT INTO run_events (run_id, seq, type, payload)
     SELECT $1, COALESCE(max(seq), 0) + 1, 'TOOL_CALL_RESULT', $2::jsonb
     FROM run_events WHERE run_id = $1`,
    [runId, JSON.stringify({ messageId: 'tool-result', toolCallId: 'tool-call', content })],
  );
}

async function earlyWork(conversationId: string): Promise<void> {
  const first = await say(h, conversationId, 'Start the export work');
  await h.t.db.query(`UPDATE messages SET content = $2 WHERE run_id = $1 AND role = 'assistant'`, [
    first.run.id,
    `Pushed ${BRANCH} and opened pull request ${PR} for ${TICKET}.`,
  ]);
  await addToolResult(
    first.run.id,
    `[${BRANCH} ${SHA}] Add CSV export\npnpm test\n${ERROR}\n    at parse (src/parse.ts:12:3)`,
  );
  for (let step = 1; step <= 7; step += 1) {
    await say(h, conversationId, `Keep going, step ${step}`);
  }
}

function expectOnlyInIdentifiers(text: string): void {
  const at = text.indexOf(IDENTIFIERS_HEADING);
  expect(at).toBeGreaterThan(-1);
  const before = text.slice(0, at);
  const facts = text.slice(at);
  for (const value of [SHA, PR, BRANCH, ERROR, TICKET]) {
    expect(before).not.toContain(value);
    expect(facts).toContain(`\`${value}\``);
  }
  expect(facts).toContain('`src/parse.ts`');
}

describe('exact identifiers after compaction', { timeout: 120_000 }, () => {
  it('carries exact identifiers from early turns and tool steps into the Spark summary', async () => {
    h = await startCompactionHarness([]);
    const id = await newChat(h, 'full-auto');
    await earlyWork(id);
    await say(h, id, 'Plan the rollout #ctx92');

    const next = await say(h, id, 'Which pull request and commit was that?');

    expect(next.steps).toContain('Compacted the chat with a Spark summary (184K tokens before)');
    const sessions = await sessionsOf(h, id);
    const [seeded] = promptsOf(h, sessions.at(-1)!.session_id);
    expectOnlyInIdentifiers(seeded!);
    const [compaction] = await compactionsOf(h, id);
    expectOnlyInIdentifiers(compaction!.summary!);
  });

  it('gives the agent the exact identifiers with its message after /compact', async () => {
    h = await startCompactionHarness(['compact']);
    const id = await newChat(h, 'hands-off');
    await earlyWork(id);
    await say(h, id, 'More detail #ctx90');

    const next = await say(h, id, 'Which pull request and commit was that?');

    expect(next.steps).toContain('Sent /compact to the agent (180K tokens)');
    const sessions = await sessionsOf(h, id);
    const sent = promptsOf(h, sessions[0]!.session_id).at(-1)!;
    expect(sent.startsWith(`${AGENT_COMPACTED_NOTE}\n\n${IDENTIFIERS_HEADING}\n`)).toBe(true);
    expect(sent).toContain('Which pull request and commit was that?');
    expectOnlyInIdentifiers(sent.slice(0, sent.indexOf('Which pull request')));
    const [compaction] = await compactionsOf(h, id);
    expect(
      compaction!.summary!.startsWith(`${FAKE_ACP_COMPACT_REPLY}\n\n${IDENTIFIERS_HEADING}`),
    ).toBe(true);
  });

  it('reads at most two million characters, cutting the text that crosses the limit', async () => {
    h = await startCompactionHarness([]);
    const id = await newChat(h, 'full-auto');
    const first = await say(h, id, 'Dump the log');
    const filler = 'log line\n'.repeat(100_000);
    await addToolResult(
      first.run.id,
      `Opened #11\n${filler}Opened #22\n${filler}${filler}Opened #33`,
    );
    const next = await say(h, id, 'Next');

    const text = await chatIdentifiers(h.t.db, {
      identity: { threadId: id, runId: next.run.id },
      projectRoots: [],
    });

    expect(text).toContain('`#11`');
    expect(text).toContain('`#22`');
    expect(text).not.toContain('#33');
  });
});
