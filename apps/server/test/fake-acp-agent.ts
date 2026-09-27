import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import { roleFor } from './fake-acp-roles.ts';
import { CODEX_DO_TRIGGER, codexDoTurn } from './fake-codex-do.ts';
import {
  createFakeSession,
  loadSessionAdvertised,
  newSessionId,
  readFakeSession,
  recordClose,
  recordPrompt,
  replayHistory,
} from './fake-acp-sessions.ts';

const fakeModels = JSON.parse(
  process.env.FAKE_ACP_MODELS ??
    JSON.stringify([
      ['fast-1', 'Fast One'],
      ['smart-2', 'Smart Two'],
    ]),
) as [string, string][];

const config: Record<string, string> = {
  mode: 'agent',
  model: fakeModels[0]?.[0] ?? 'fast-1',
  effort: 'medium',
};

const select = (
  id: string,
  category: string,
  values: [string, string][],
): acp.SessionConfigOption => ({
  id,
  name: id,
  category,
  type: 'select',
  currentValue: config[id] ?? '',
  options: values.map(([value, name]) => ({ value, name })),
});

const configOptions = (): acp.SessionConfigOption[] => [
  select('mode', 'mode', [
    ['read-only', 'Ask first'],
    ['ask-every-action', 'Ask every time'],
    ['agent', 'Agent'],
  ]),
  select('model', 'model', fakeModels),
  select('effort', 'thought_level', [
    ['low', 'Low'],
    ['medium', 'Medium'],
    ['high', 'High'],
  ]),
];

const advertisedCommands = JSON.parse(process.env.FAKE_ACP_COMMANDS ?? '[]') as string[];

function slashCommand(prompt: acp.ContentBlock[]): { name: string; rest: string } | null {
  const first = prompt[0];
  if (first?.type !== 'text') return null;
  const trimmed = first.text.trim();
  if (!trimmed.startsWith('/')) return null;
  const [name = '', ...rest] = trimmed.slice(1).split(/\s+/);
  return { name: name.toLowerCase(), rest: rest.join(' ') };
}

let clientCapabilities: unknown = null;
let sessionCwd = '';
let sessionDirectories: string[] | null = null;
const pending = new Map<string, AbortController>();
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    });
  });

const promptCapabilities = JSON.parse(
  process.env.FAKE_ACP_PROMPT_CAPABILITIES ?? '{}',
) as acp.PromptCapabilities;
const sessionCapabilities = JSON.parse(
  process.env.FAKE_ACP_SESSION_CAPABILITIES ?? '{}',
) as acp.SessionCapabilities;

function describeBlock(block: acp.ContentBlock): string {
  if (block.type === 'image') return `image:${block.mimeType}:${block.data.length}`;
  if (block.type === 'resource') return `resource:${block.resource.uri}`;
  return block.type;
}

async function fileRequests(
  text: string,
  sessionId: string,
  client: acp.AgentContext,
  say: (chunk: string) => Promise<void>,
): Promise<void> {
  const outcome = async (request: Promise<{ content?: string } | acp.WriteTextFileResponse>) => {
    try {
      const response = await request;
      return `ok:${'content' in response ? response.content : ''}`;
    } catch (error) {
      return `err:${(error as { code?: number }).code ?? 'unknown'}`;
    }
  };
  for (const match of text.matchAll(/#read (\S+)(?: (\d+) (\d+))?/g)) {
    const [, path, line, limit] = match;
    const result = await outcome(
      client.request(acp.methods.client.fs.readTextFile, {
        sessionId,
        path: path!,
        ...(line ? { line: Number(line), limit: Number(limit) } : {}),
      }),
    );
    await say(`[${path}=${result}]`);
  }
  for (const match of text.matchAll(/#fswrite (\S+)/g)) {
    const path = match[1]!;
    const result = await outcome(
      client.request(acp.methods.client.fs.writeTextFile, { sessionId, path, content: 'x' }),
    );
    await say(`[write ${path}=${result}]`);
  }
}

const FAKE_SECRETS = {
  apiKey: 'sk-proj-abcdefghijklmnopqrstuvwx',
  github: 'ghp_abcdefghijklmnopqrstuvwxyz0123',
  envFile: 'PLAIN_VALUE=hello-from-dotenv',
  stderr: 'Bearer abc123def456ghi789',
};

async function leakSecrets(
  update: (value: acp.SessionUpdate) => Promise<void>,
  say: (chunk: string) => Promise<void>,
): Promise<acp.StopReason> {
  process.stderr.write(`auth header ${FAKE_SECRETS.stderr}\n`);
  await update({
    sessionUpdate: 'tool_call',
    toolCallId: 's1',
    title: 'Run printenv',
    kind: 'execute',
    status: 'in_progress',
    rawInput: { command: ['printenv'] },
  });
  await update({
    sessionUpdate: 'tool_call_update',
    toolCallId: 's1',
    status: 'completed',
    rawOutput: { stdout: `OPENAI_API_KEY=${FAKE_SECRETS.apiKey}\nHOME=/home/x`, exitCode: 0 },
    content: [{ type: 'content', content: { type: 'text', text: `token ${FAKE_SECRETS.github}` } }],
  });
  await update({
    sessionUpdate: 'tool_call',
    toolCallId: 's2',
    title: 'Read .env',
    kind: 'read',
    status: 'in_progress',
    rawInput: { file_path: '/work/app/.env' },
  });
  await update({
    sessionUpdate: 'tool_call_update',
    toolCallId: 's2',
    status: 'completed',
    rawOutput: FAKE_SECRETS.envFile,
  });
  await say('done');
  return 'end_turn';
}

const FAKE_USAGE = { totalTokens: 180, inputTokens: 120, outputTokens: 60, cachedReadTokens: 100 };

const CREDENTIAL_NAMES = /ANTHROPIC|CLAUDE|OPENAI|AWS|_KEY$|TOKEN|SECRET/;

async function reportEnvironment(
  update: (value: acp.SessionUpdate) => Promise<void>,
  say: (chunk: string) => Promise<void>,
): Promise<acp.StopReason> {
  const env = process.env;
  const names = Object.keys(env)
    .filter((name) => CREDENTIAL_NAMES.test(name))
    .sort();
  process.stderr.write(`env names ${names.join(',')}\n`);
  await update({
    sessionUpdate: 'usage_update',
    used: 1_000,
    size: 1_000_000,
    cost: { amount: 1.23, currency: 'USD' },
  });
  await say(
    JSON.stringify({
      names,
      baseUrl: env.ANTHROPIC_BASE_URL ?? null,
      configDir: env.CLAUDE_CONFIG_DIR ?? null,
      token: env.ANTHROPIC_AUTH_TOKEN ? 'set' : 'missing',
      tokenLength: env.ANTHROPIC_AUTH_TOKEN?.length ?? 0,
      opus: env.ANTHROPIC_DEFAULT_OPUS_MODEL ?? null,
      haiku: env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? null,
      timeout: env.API_TIMEOUT_MS ?? null,
    }),
  );
  return 'end_turn';
}

async function turn(
  params: acp.PromptRequest,
  client: acp.AgentContext,
  signal: AbortSignal,
): Promise<acp.StopReason> {
  const text = params.prompt.map((block) => (block.type === 'text' ? block.text : '')).join('');
  const sessionId = params.sessionId;
  const update = (value: acp.SessionUpdate) =>
    client.notify(acp.methods.client.session.update, { sessionId, update: value });
  const say = (chunk: string, messageId = 'm1') =>
    update({
      sessionUpdate: 'agent_message_chunk',
      messageId,
      content: { type: 'text', text: chunk },
    });

  if (advertisedCommands.length > 0) {
    await update({
      sessionUpdate: 'available_commands_update',
      availableCommands: advertisedCommands.map((name) => ({
        name,
        description: `Run ${name}`,
        input: name === 'review' ? { hint: 'what to review' } : null,
      })),
    });
  }
  const command = slashCommand(params.prompt);
  if (command && advertisedCommands.includes(command.name)) {
    await say(`command=/${command.name} args=${command.rest}`);
    return 'end_turn';
  }
  if (text.includes('#silent')) return 'end_turn';
  if (text.includes('#recall')) {
    await say(
      `recall=${JSON.stringify(readFakeSession(sessionId).prompts)} blocks=${params.prompt.length}`,
    );
    return 'end_turn';
  }
  const role = roleFor(text);
  if (role) return role({ text, sessionId, cwd: sessionCwd, client, update, say, signal });
  if (text.includes('#blocks')) {
    await say(JSON.stringify(params.prompt.map(describeBlock)));
    return 'end_turn';
  }
  if (text.includes('#cwd')) {
    await say(`cwd=${sessionCwd} process=${process.cwd()}`);
    return 'end_turn';
  }
  if (text.includes('#dirs')) {
    await say(`dirs=${JSON.stringify(sessionDirectories)}`);
    return 'end_turn';
  }
  if (text.includes('#env')) return reportEnvironment(update, say);
  if (text.includes('#caps')) {
    await say(JSON.stringify(clientCapabilities));
    return 'end_turn';
  }
  if (text.includes('#crash')) process.exit(3);
  if (text.includes('#read ') || text.includes('#fswrite ')) {
    await fileRequests(text, sessionId, client, say);
    return 'end_turn';
  }
  if (text.includes('#auth')) throw acp.RequestError.authRequired();
  if (text.includes('#refuse')) return 'refusal';
  if (text.includes('#secret')) return leakSecrets(update, say);
  if (text.includes('#failure')) {
    const failure = (severity: string, title: string) =>
      update({
        sessionUpdate: 'session_info_update',
        _meta: {
          jetbrains: {
            air: { version: 1, sessionFailure: { severity, title, category: 'auth_required' } },
          },
        },
      });
    await failure('warning', 'Reconnecting to the model');
    await say('401 Unauthorized as plain text');
    await failure('error', 'unexpected status 401 Unauthorized');
    return 'end_turn';
  }
  if (text.includes('#slow')) {
    for (let index = 0; ; index++) {
      await say(`word${index} `);
      await sleep(20, signal);
    }
  }
  if (text.includes(CODEX_DO_TRIGGER)) {
    return codexDoTurn(text, sessionCwd, sessionId, client, (chunk) => say(chunk));
  }
  if (text.includes('#write')) {
    await update({
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      title: 'Write notes.txt',
      kind: 'edit',
      status: 'pending',
    });
    const answer = await client.request(acp.methods.client.session.requestPermission, {
      sessionId,
      toolCall: { toolCallId: 't1', title: 'Write notes.txt', kind: 'edit', status: 'pending' },
      options: [
        { optionId: 'yes', name: 'Yes', kind: 'allow_once' },
        { optionId: 'no', name: 'No', kind: 'reject_once' },
      ],
    });
    const chose = answer.outcome.outcome === 'selected' ? answer.outcome.optionId : 'cancelled';
    await update({
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: chose === 'yes' ? 'completed' : 'failed',
    });
    await say(`permission=${chose}`);
    return 'end_turn';
  }
  await update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' } });
  await update({
    sessionUpdate: 'tool_call',
    toolCallId: 'r1',
    title: 'Read context',
    kind: 'read',
    status: 'in_progress',
  });
  await update({ sessionUpdate: 'tool_call_update', toolCallId: 'r1', status: 'completed' });
  await say('Hello');
  await say(' there', 'm1');
  await say(`mode=${config.mode} model=${config.model} effort=${config.effort}`, 'm2');
  await say(`\nprompt=${text}`, 'm2');
  return 'end_turn';
}

acp
  .agent({ name: 'fake-acp-agent' })
  .onRequest(acp.methods.agent.initialize, (ctx) => {
    clientCapabilities = ctx.params.clientCapabilities ?? null;
    return {
      protocolVersion: Number(process.env.FAKE_ACP_PROTOCOL_VERSION ?? acp.PROTOCOL_VERSION),
      agentCapabilities: {
        loadSession: loadSessionAdvertised,
        promptCapabilities,
        sessionCapabilities,
      },
    };
  })
  .onRequest(acp.methods.agent.session.new, (ctx) => {
    sessionCwd = ctx.params.cwd;
    sessionDirectories = ctx.params.additionalDirectories ?? null;
    const sessionId = newSessionId();
    createFakeSession(sessionId, sessionCwd, sessionDirectories);
    return process.env.FAKE_ACP_LEGACY
      ? {
          sessionId: 'fake-session',
          modes: {
            currentModeId: config.mode ?? '',
            availableModes: [
              { id: 'read-only', name: 'Ask first' },
              { id: 'agent', name: 'Agent' },
            ],
          },
          models: {
            currentModelId: config.model,
            availableModels: [
              { modelId: 'fast-1', name: 'Fast One' },
              { modelId: 'smart-2', name: 'Smart Two' },
            ],
          },
        }
      : { sessionId, configOptions: configOptions() };
  })
  .onRequest(acp.methods.agent.session.resume, (ctx) => {
    readFakeSession(ctx.params.sessionId);
    sessionCwd = ctx.params.cwd;
    sessionDirectories = ctx.params.additionalDirectories ?? null;
    return { configOptions: configOptions() };
  })
  .onRequest(acp.methods.agent.session.load, async (ctx) => {
    const stored = readFakeSession(ctx.params.sessionId);
    sessionCwd = ctx.params.cwd;
    sessionDirectories = ctx.params.additionalDirectories ?? null;
    await replayHistory(ctx.params.sessionId, stored, (sessionId, update) =>
      ctx.client.notify(acp.methods.client.session.update, { sessionId, update }),
    );
    return { configOptions: configOptions() };
  })
  .onRequest(acp.methods.agent.session.close, (ctx) => {
    recordClose(ctx.params.sessionId);
    return {};
  })
  .onRequest(acp.methods.agent.session.setMode, (ctx) => {
    config.mode = ctx.params.modeId;
    return {};
  })
  .onRequest(acp.methods.agent.session.setConfigOption, (ctx) => {
    const { configId, value } = ctx.params as { configId: string; value: string };
    if (!configOptions().some((option) => option.id === configId)) {
      throw acp.RequestError.invalidParams({ configId }, 'Unknown config option.');
    }
    config[configId] = value;
    return { configOptions: configOptions() };
  })
  .onRequest(acp.methods.agent.session.prompt, async (ctx) => {
    const controller = new AbortController();
    pending.set(ctx.params.sessionId, controller);
    try {
      const text = ctx.params.prompt.map((block) => (block.type === 'text' ? block.text : ''));
      recordPrompt(ctx.params.sessionId, text.join(''));
      const stopReason = await turn(ctx.params, ctx.client, controller.signal);
      return { stopReason, usage: FAKE_USAGE };
    } catch (error) {
      if (controller.signal.aborted) return { stopReason: 'cancelled' as const, usage: FAKE_USAGE };
      throw error;
    }
  })
  .onNotification(acp.methods.agent.session.cancel, (ctx) => {
    pending.get(ctx.params.sessionId)?.abort();
  })
  .connect(
    acp.ndJsonStream(
      Writable.toWeb(process.stdout),
      Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
    ),
  );
