import type * as acp from '@agentclientprotocol/sdk';
import { write, type RoleTurn } from './fake-acp-roles.ts';

export function rateLimited(turn: RoleTurn, key: string, tag: RegExp): boolean {
  return process.env.FAKE_ACP_PROVIDER === 'codex' && key === 'P1' && tag.test(turn.text);
}

const RETRY_LIMIT = 'exceeded retry limit, last status: 429 Too Many Requests';
const failedTurns = new Map<string, Record<string, unknown>>();

function airFailure(severity: 'warning' | 'error') {
  return {
    jetbrains: {
      air: {
        version: 1,
        sessionFailure: {
          id: 't:error',
          revision: 1,
          category: 'limit',
          severity,
          title: RETRY_LIMIT,
        },
      },
    },
  };
}

export function withTurnFailure(
  sessionId: string,
  response: acp.PromptResponse,
): acp.PromptResponse {
  const meta = failedTurns.get(sessionId);
  failedTurns.delete(sessionId);
  return meta ? { ...response, _meta: meta } : response;
}

export async function codexLimited(turn: RoleTurn, key: string, file: string): Promise<boolean> {
  if (rateLimited(turn, key, /#turn429(?!after)/)) {
    await turn.say(`I'll build ${key} in ${file}.`);
    failedTurns.set(turn.sessionId, airFailure('error'));
    return true;
  }
  if (rateLimited(turn, key, /#turn429after/)) {
    await write(turn, file, `built by ${key}`);
    failedTurns.set(turn.sessionId, airFailure('error'));
    return true;
  }
  if (rateLimited(turn, key, /#retry429/)) {
    await turn.say(`I'll build ${key} in ${file}.`);
    await turn.update({ sessionUpdate: 'session_info_update', _meta: airFailure('warning') });
    return true;
  }
  return false;
}
