import { describe, expect, it } from 'vitest';
import { agentErrorsIn, failureOf, type RunOutcome } from './failure.ts';

const NO_KEY = 'Z.ai (GLM) has no stored API key. Paste the key again in Settings.';
const BODY = '{"error":{"code":"1113","message":"Insufficient balance or no resource package."}}';

function outcome(extra: Partial<RunOutcome> = {}): RunOutcome {
  return { runId: 'run-1', status: 'succeeded', error: null, details: null, ...extra };
}

function errorRow(message: string, runId = 'run-2') {
  return {
    runId,
    seq: 9,
    at: 0,
    direction: 'from_agent',
    kind: 'error',
    method: 'session/prompt',
    payload: { id: 4, error: { code: -32603, message } },
    unreviewed: false,
  };
}

describe('why a run ended without an answer', () => {
  it('is nothing when every run succeeded and the agent refused nothing', () => {
    expect(failureOf([outcome(), outcome({ runId: 'run-2' })], [], 'ok')).toBeNull();
  });

  it("gives Spark's failure text once, with how many runs ended that way, and Spark's reply", () => {
    const failed = (runId: string) => outcome({ runId, status: 'failed', error: NO_KEY });
    const failure = failureOf(
      [outcome(), failed('run-2'), failed('run-3'), failed('run-4')],
      [],
      'Needs you: Stopped after 2 retries.',
    );
    expect(failure).toEqual({
      reason: `3 runs failed: ${NO_KEY}; Spark replied: Needs you: Stopped after 2 retries.`,
    });
  });

  it('gives what the agent answered, once, after what Spark recorded', () => {
    const said = `Provider error (HTTP 429): ${BODY}`;
    const rows = [errorRow(said), errorRow(said), { ...errorRow('unrelated'), kind: 'response' }];
    const failure = failureOf(
      [outcome({ status: 'failed', error: 'Z.ai (GLM) has no balance left.', details: BODY })],
      agentErrorsIn(rows),
      '',
    );
    expect(failure?.reason).toBe(
      `1 run failed: Z.ai (GLM) has no balance left. [${BODY}]; the agent answered session/prompt with: ${said}`,
    );
  });

  it("keeps the agent's own reply out of the reason", () => {
    const failed = outcome({ runId: 'run-2', status: 'failed', error: NO_KEY });
    const failure = failureOf([outcome(), failed], [], 'The rate is 0.0825. CHAT-TEXT');
    expect(failure?.reason).toBe(`1 run failed: ${NO_KEY}`);
  });

  it('says so when Spark recorded no reason, and names a run that was stopped', () => {
    const failure = failureOf([outcome({ status: 'cancelled' })], [], '');
    expect(failure?.reason).toBe('1 run cancelled: Spark recorded no reason');
  });

  it('redacts a secret a failure text carries', () => {
    const leaked =
      'request failed with header Authorization: Bearer sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
    const failure = failureOf([outcome({ status: 'failed', error: leaked })], [], '');
    expect(failure?.reason).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789');
  });
});
