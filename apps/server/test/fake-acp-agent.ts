import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import { currentRequest, planReplies, planTurn } from './fake-acp-plans.ts';
import { roleFor } from './fake-acp-roles.ts';
import { coordinatorRoleFor, steerParams, steerRequest } from './fake-acp-coordinator.ts';
import { codexTurn } from './fake-codex-do.ts';
import { FOUR_KINDS_TRIGGER, fourKindsTurn } from './fake-acp-four-kinds.ts';
import { modeTurn } from './fake-acp-modes.ts';
import { sparkTurn } from './fake-acp-spark.ts';
import { describeBlock } from './fake-acp-support.ts';
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

const fakeModes = JSON.parse(
  process.env.FAKE_ACP_MODES ??
    JSON.stringify([
      ['read-only', 'Ask first', null, null],
      ['ask-every-action', 'Ask every time', null, null],
      ['agent', 'Agent', null, 'auto_review'],
      ['default', 'Manual', null, 'standard'],
      ['acceptEdits', 'Accept edits', null, 'standard'],
      ['plan', 'Plan', null, 'plan'],
      ['bypassPermissions', 'Bypass permissions', null, 'full_access'],
    ]),
) as [string, string, string | null, string | null][];

const config: Record<string, string> = {
  mode: 'agent',
  model: fakeModels[0]?.[0] ?? 'fast-1',
  effort: 'medium',
};
let fast = false;

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

const modeOption = (): acp.SessionConfigOption => ({
  id: 'mode',
  name: 'Mode',
  category: 'mode',
  type: 'select',
  currentValue: config.mode ?? '',
  options: fakeModes.map(([value, name, description, kind]) => ({
    value,
    name,
    ...(description ? { description } : {}),
    ...(kind ? { _meta: { kind } } : {}),
  })),
});

const fastOption = (): acp.SessionConfigOption[] =>
  process.env.FAKE_ACP_FAST
    ? [
        {
          id: 'fast',
          name: 'Fast mode',
          description: 'Faster replies at a higher price',
          category: 'model_config',
          type: 'boolean',
          currentValue: fast,
        },
      ]
    : [];

const configOptions = (): acp.SessionConfigOption[] => [
  modeOption(),
  select('model', 'model', fakeModels),
  select('effort', 'thought_level', [
    ['low', 'Low'],
    ['medium', 'Medium'],
    ['high', 'High'],
  ]),
  ...fastOption(),
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
let sessionRequest: { meta: unknown; mcpServers: unknown } | null = null;
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
  const moded = await modeTurn({ text, config, options: configOptions, update, say, signal });
  if (moded) return moded;
  const roleTurn = { text, sessionId, cwd: sessionCwd, client, update, say, signal };
  const asked = currentRequest(params.prompt);
  const planned = await planTurn(asked, roleTurn, config.mode ?? '');
  if (planned) return planned;
  if (await planReplies(asked, say)) return 'end_turn';
  if (text.includes(FOUR_KINDS_TRIGGER)) return fourKindsTurn(sessionId, sessionCwd, client, say);
  const role = coordinatorRoleFor(text) ?? roleFor(text);
  if (role) return role(roleTurn);
  if (text.includes('#blocks')) {
    await say(JSON.stringify(params.prompt.map(describeBlock)));
    return 'end_turn';
  }
  if (text.includes('#cwd')) {
    await say(`cwd=${sessionCwd} process=${process.cwd()}`);
    return 'end_turn';
  }
  if (text.includes('#session')) {
    await say(
      `session=${JSON.stringify({ ...sessionRequest, codexConfig: process.env.CODEX_CONFIG ?? null })}`,
    );
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
  const sparked = await sparkTurn(text, sessionRequest?.mcpServers, update, say);
  if (sparked) return sparked;
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
  if (text.includes('#stubborn')) {
    for (let index = 0; ; index++) {
      await say(`word${index} `);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  if (text.includes('#slow')) {
    for (let index = 0; ; index++) {
      await say(`word${index} `);
      await sleep(20, signal);
    }
  }
  const codexed = await codexTurn(roleTurn, config.mode ?? '');
  if (codexed) return codexed;
  if (text.includes('#write') || text.includes('#command')) {
    const tool = text.includes('#command')
      ? { title: 'curl -sI https://example.com', kind: 'execute' as const }
      : { title: 'Write notes.txt', kind: 'edit' as const };
    await update({ sessionUpdate: 'tool_call', toolCallId: 't1', ...tool, status: 'pending' });
    const answer = await client.request(acp.methods.client.session.requestPermission, {
      sessionId,
      toolCall: { toolCallId: 't1', ...tool, status: 'pending' },
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
  await say(
    `mode=${config.mode} model=${config.model} effort=${config.effort}${process.env.FAKE_ACP_FAST ? ` fast=${fast}` : ''}`,
    'm2',
  );
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
        ...(process.env.FAKE_ACP_MCP_CAPABILITIES
          ? { mcpCapabilities: JSON.parse(process.env.FAKE_ACP_MCP_CAPABILITIES) as object }
          : {}),
      },
      ...(process.env.FAKE_ACP_STEERING ? { _meta: { steering: { supported: true } } } : {}),
    };
  })
  .onRequest('_session/steering', steerParams, steerRequest)
  .onRequest(acp.methods.agent.session.new, (ctx) => {
    sessionRequest = { meta: ctx.params._meta ?? null, mcpServers: ctx.params.mcpServers };
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
    const { configId, value } = ctx.params as { configId: string; value: string | boolean };
    if (!configOptions().some((option) => option.id === configId)) {
      throw acp.RequestError.invalidParams({ configId }, 'Unknown config option.');
    }
    if (typeof value === 'boolean') fast = value;
    else config[configId] = value;
    return { configOptions: configOptions() };
  })
  .onRequest(acp.methods.agent.session.prompt, async (ctx) => {
    const controller = new AbortController();
    pending.set(ctx.params.sessionId, controller);
    const text = ctx.params.prompt.map((block) => (block.type === 'text' ? block.text : ''));
    try {
      recordPrompt(ctx.params.sessionId, text.join(''));
      const stopReason = await turn(ctx.params, ctx.client, controller.signal);
      return { stopReason, usage: FAKE_USAGE };
    } catch (error) {
      if (controller.signal.aborted) {
        const unmetered = text.join('').includes('#spend');
        return { stopReason: 'cancelled' as const, ...(unmetered ? {} : { usage: FAKE_USAGE }) };
      }
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
