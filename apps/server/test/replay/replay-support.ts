import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { modeForLegacy, type HarnessSetting } from '@spark-outpost/contracts';
import { sendUserMessage } from '../../src/persistence/conversations.ts';
import { runCommand } from '../../src/setup/command.ts';
import { memorySecretStore } from '../../src/setup/secrets.ts';
import { linkedConversation } from '../approval-support.ts';
import { PIECE_CHECK_SCRIPT } from '../fake-acp-coordinator.ts';
import {
  assistantReplies,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  setCheckCommands,
  startOrchestrator,
  type JevScript,
} from '../orchestration-support.ts';
import { FAKE_GH, repoWithRemote, startGitHubStub, type GitHubStub } from '../ship-support.ts';
import { createTestDb, pinChatLevel, type TestDb } from '../support.ts';
import type { ReplayCase, ReplayTurn } from './replay-cases.ts';
import { ledgerCounts, replayRow, type LedgerCounts, type ReplayRow } from './replay-metrics.ts';

const OLD_FAILURE = `console.log(' FAIL  libs/dates/src/holidays.test.ts > today is a working day');
process.exit(1);
`;

const TURN_TIMEOUT_MS = 120_000;

export interface ReplayResult {
  row: ReplayRow;
  ledger: LedgerCounts;
  conversationId: string;
  db: TestDb;
  cleanup(): Promise<void>;
}

interface Place {
  root: string;
  base: string;
  stub: GitHubStub | null;
}

function commitAll(root: string, message: string): void {
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args]);
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', message);
}

async function placeFor(replay: ReplayCase): Promise<Place> {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-replay-')));
  if (replay.repo !== 'remote') {
    const root = await gitRepo();
    if (replay.pieceCheck) await writeFile(path.join(root, 'piece-check.mjs'), PIECE_CHECK_SCRIPT);
    if (replay.failingCheck) writeFileSync(path.join(root, 'check.mjs'), OLD_FAILURE);
    if (replay.pieceCheck || replay.failingCheck) commitAll(root, 'replay fixture');
    return { root, base, stub: null };
  }
  process.env.FAKE_GH_NODE = process.execPath;
  process.env.FAKE_GH_STATE = path.join(base, 'gh-state');
  await writeFile(path.join(base, 'gh-state'), 'octo-cli');
  const stub = await startGitHubStub();
  process.env.FAKE_GH_API = stub.url;
  const repo = await repoWithRemote(base, 'widgets');
  return { root: repo.root, base, stub };
}

async function send(t: TestDb, conversationId: string, turn: ReplayTurn) {
  const level = turn.level ?? 'hands-off';
  return sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: turn.scenario.text },
    {
      provider: 'claude',
      model: 'sonnet',
      effort: 'medium',
      permission: turn.scenario.mode,
      agentMode: modeForLegacy('claude', turn.scenario.mode, level),
      level,
      ...(turn.source ? { source: turn.source } : {}),
    },
  );
}

export async function runReplay(
  replay: ReplayCase,
  harness: HarnessSetting,
): Promise<ReplayResult> {
  const t = await createTestDb({ workPlace: replay.repo === 'remote' ? 'worktree' : 'checkout' });
  const place = await placeFor(replay);
  const store = mkdtempSync(path.join(tmpdir(), 'fake-acp-store-'));
  await connectProviders(t);
  if (replay.failingCheck) await setCheckCommands(t, place.root, ['node check.mjs']);
  const script: JevScript = { calls: [] };
  const orchestrator = startOrchestrator(t, jevFetch(script), {
    sessions: store,
    harness,
    ...(replay.coordinator ? { coordinator: replay.coordinator } : {}),
    ...(place.stub
      ? {
          shipAccess: {
            secrets: memorySecretStore(),
            runCommand,
            fetch,
            apiUrl: place.stub.url,
            locateGh: async () => FAKE_GH,
          },
        }
      : {}),
  });
  const cleanup = async () => {
    await orchestrator.stop();
    await place.stub?.close();
    await t.cleanup();
    await rm(place.root, { recursive: true, force: true });
    await rm(place.base, { recursive: true, force: true });
    rmSync(store, { recursive: true, force: true });
  };
  try {
    const { conversationId } = await linkedConversation(t, place.root);
    await t.db.query(`UPDATE conversations SET model_routing = 'auto' WHERE id = $1`, [
      conversationId,
    ]);
    const replies: string[] = [];
    const startedAt = Date.now();
    for (const turn of replay.turns) {
      await pinChatLevel(t.db, conversationId, turn.level ?? 'hands-off');
      script.scenario = turn.scenario;
      delete script.verify;
      delete script.verdicts;
      if (turn.jev?.verify !== undefined) script.verify = turn.jev.verify;
      if (turn.jev?.verdicts) script.verdicts = [...turn.jev.verdicts];
      const sent = await send(t, conversationId, turn);
      orchestrator.worker.wake();
      await driveToEnd(t, conversationId, sent.run.id, undefined, TURN_TIMEOUT_MS);
      replies.push((await assistantReplies(t, sent.run.id)).join('\n'));
    }
    return {
      row: {
        ...(await replayRow(t, conversationId, replay.title, harness, replies)),
        seconds: Math.round((Date.now() - startedAt) / 1000),
      },
      ledger: await ledgerCounts(t, conversationId),
      conversationId,
      db: t,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
