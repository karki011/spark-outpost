import * as acp from '@agentclientprotocol/sdk/unstable';
import {
  applyAskElicitationResponse,
  askUserQuestionsToCreateRequest,
} from '@agentclientprotocol/claude-agent-acp/dist/elicitation.js';

export const ASK_CLAUDE_TRIGGER = '#askclaude';
export const ASK_CODEX_TRIGGER = '#askcodex';
export const ASK_WITHDRAW_TRIGGER = '#askwithdraw';

type AskedQuestions = Parameters<typeof askUserQuestionsToCreateRequest>[0];

export const STORE_QUESTION: AskedQuestions[number] = {
  question: 'Which store should the cache use?',
  header: 'Store',
  multiSelect: false,
  options: [
    { label: 'Postgres', description: 'Already running' },
    { label: 'Redis', description: 'Faster, one more service' },
  ],
};

export const CHECKS_QUESTION: AskedQuestions[number] = {
  question: 'Which checks should run before the push?',
  header: 'Checks',
  multiSelect: true,
  options: [
    { label: 'Lint', description: 'eslint' },
    { label: 'Types', description: 'tsc' },
    { label: 'Unit tests', description: 'vitest' },
  ],
};

export const CLAUDE_QUESTIONS: AskedQuestions = [STORE_QUESTION, CHECKS_QUESTION];

export function codexQuestion(sessionId: string): acp.CreateElicitationRequest {
  return {
    sessionId,
    toolCallId: 'item-ask',
    mode: 'form',
    message: 'Codex needs your input to continue.',
    requestedSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          title: 'What should the cache be called?',
          _meta: { codex: { isOther: false, isSecret: false } },
        },
      },
      required: ['name'],
    },
  };
}

type Say = (chunk: string) => Promise<void>;

async function askClaude(client: acp.AgentContext, sessionId: string, say: Say) {
  const request = askUserQuestionsToCreateRequest(CLAUDE_QUESTIONS, sessionId, 'toolu_ask');
  const response = await client.request(acp.methods.client.elicitation.create, request);
  const toolInput = { questions: CLAUDE_QUESTIONS };
  const result = applyAskElicitationResponse(response, toolInput, CLAUDE_QUESTIONS);
  const answers = result.action === 'answered' ? result.updatedInput.answers : null;
  await say(`asked=${response.action} answers=${JSON.stringify(answers)}`);
}

async function askCodex(client: acp.AgentContext, sessionId: string, say: Say) {
  const response = await client.request(
    acp.methods.client.elicitation.create,
    codexQuestion(sessionId),
  );
  await say(`asked=${JSON.stringify(response)}`);
}

async function askThenWithdraw(client: acp.AgentContext, sessionId: string, say: Say) {
  const withdraw = new AbortController();
  const timer = setTimeout(() => withdraw.abort(), Number(process.env.FAKE_ACP_WITHDRAW_MS ?? 500));
  try {
    const response = await client.request(
      acp.methods.client.elicitation.create,
      codexQuestion(sessionId),
      { cancellationSignal: withdraw.signal },
    );
    await say(`asked=${JSON.stringify(response)}`);
  } catch {
    await say('asked=withdrawn');
  } finally {
    clearTimeout(timer);
  }
}

export async function questionTurn(
  text: string,
  client: acp.AgentContext,
  sessionId: string,
  say: Say,
): Promise<acp.StopReason | null> {
  if (text.includes(ASK_CLAUDE_TRIGGER)) await askClaude(client, sessionId, say);
  else if (text.includes(ASK_CODEX_TRIGGER)) await askCodex(client, sessionId, say);
  else if (text.includes(ASK_WITHDRAW_TRIGGER)) await askThenWithdraw(client, sessionId, say);
  else return null;
  return 'end_turn';
}
