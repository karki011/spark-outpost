import type { BenchEnv } from '../../bench/live.ts';
import { codexTurn, inProcessSession, type CodexEffort, type InProcessSession } from '../direct.ts';
import type { DayRepo } from './repos.ts';
import type { DaySession } from './session-types.ts';
import {
  NO_HARNESS_EVIDENCE,
  type ArmDay,
  type ArmSessionResult,
  type PreparedTurn,
  type TurnLog,
} from './arm.ts';

const CODEX_EFFORT: CodexEffort = 'medium';

function result(logs: TurnLog[], timeoutMs: number): ArmSessionResult {
  const reply = logs.at(-1)?.metrics.reply ?? '';
  const timedOut = logs.some((log) => !log.interrupted && log.metrics.wallMs >= timeoutMs);
  const error = logs.find((log) => !log.interrupted && log.metrics.error)?.metrics.error ?? null;
  return {
    ...NO_HARNESS_EVIDENCE,
    logs,
    reply,
    replyMessageId: null,
    reviewText: logs.map((log) => log.metrics.reply).join('\n'),
    timedOut,
    error,
    cappedAtUsd: null,
    interventions: [],
    conversation: null,
  };
}

export class DirectClaudeDay implements ArmDay {
  readonly arm = 'direct-claude' as const;
  private readonly sessions = new Map<string, InProcessSession>();

  constructor(
    private readonly env: BenchEnv,
    private readonly timeoutMs: number,
  ) {}

  async run(
    session: DaySession,
    repo: DayRepo,
    turns: readonly PreparedTurn[],
  ): Promise<ArmSessionResult> {
    let agent = session.directNewSession ? undefined : this.sessions.get(session.thread);
    if (!agent) {
      agent = await inProcessSession(this.env, repo.path, this.timeoutMs);
      this.sessions.set(session.thread, agent);
    }
    const logs: TurnLog[] = [];
    for (const turn of turns) {
      const sent = await agent.send(
        turn.text,
        turn.interruptAfterMs === null ? {} : { cancelAfterMs: turn.interruptAfterMs },
      );
      logs.push({
        prompt: turn.text,
        metrics: sent.metrics,
        interrupted: turn.interruptAfterMs !== null && sent.metrics.status === 'cancelled',
      });
    }
    return result(logs, this.timeoutMs);
  }
}

export class DirectCodexDay implements ArmDay {
  readonly arm = 'direct-codex' as const;
  private readonly threads = new Map<string, string | null>();

  constructor(private readonly timeoutMs: number) {}

  async run(
    session: DaySession,
    repo: DayRepo,
    turns: readonly PreparedTurn[],
  ): Promise<ArmSessionResult> {
    let threadId = session.directNewSession ? null : (this.threads.get(session.thread) ?? null);
    const logs: TurnLog[] = [];
    for (const turn of turns) {
      const next = await codexTurn(
        repo.path,
        turn.text,
        threadId,
        this.timeoutMs,
        CODEX_EFFORT,
        turn.interruptAfterMs === null ? {} : { cancelAfterMs: turn.interruptAfterMs },
      );
      threadId = next.threadId;
      logs.push({
        prompt: turn.text,
        metrics: next.turn.metrics,
        interrupted:
          turn.interruptAfterMs !== null && next.turn.metrics.wallMs >= turn.interruptAfterMs,
      });
    }
    this.threads.set(session.thread, threadId);
    return result(logs, this.timeoutMs);
  }
}
