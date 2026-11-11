import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk/unstable';
import { currentRequest, planReplies, planTurn } from './fake-acp-plans.ts';
import { buildTurn } from './fake-acp-build.ts';
import { pushAuthStatus, rejectedTurn, signedOut } from './fake-acp-access.ts';
import { codexTurn } from './fake-codex-do.ts';
import { FOUR_KINDS_TRIGGER, fourKindsTurn } from './fake-acp-four-kinds.ts';
import { questionTurn } from './fake-acp-questions.ts';
import { modeTurn } from './fake-acp-modes.ts';
import { railCrossings } from './fake-acp-rails.ts';
import { floorTurn } from './fake-acp-floor.ts';
import { terminalCommands } from './fake-acp-terminal.ts';
import { publishTurn } from './fake-acp-publish.ts';
import { sparkTurn } from './fake-acp-spark.ts';
import { blocksTurn } from './fake-acp-attachments.ts';
import { rememberConfig, restoreConfig } from './fake-acp-support.ts';
import { FAKE_AGENT_INFO, fakeMcpCapabilities } from './fake-acp-init.ts';
import { compactionTurn, eventsTurn, leakSecrets } from './fake-acp-events.ts';
import {
  orphanedCommandTurn,
  subagentAsksTurn,
  subagentModelTurn,
  subagentsTurn,
  wideSubagentTurn,
} from './fake-acp-subagents.ts';
import { commandTurn, reportContext } from './fake-acp-context.ts';
import { isTitleTrigger, titleTurn } from './fake-acp-titles.ts';
import {
  BACKGROUND_TRIGGER,
  CYCLE_TRIGGER,
  HANDBACK_TRIGGER,
  ownFollowUpTurn,
  promptWouldFold,
  LATER_TRIGGER,
  backgroundTurn,
  handbackTurn,
  laterTurn,
} from './fake-acp-background.ts';
import { rateLimitTurn } from './fake-acp-rate-limit.ts';
import { SLEEP_TRIGGER, sleepTurn } from './fake-acp-sleep.ts';
import { windowTurn } from './fake-acp-window.ts';
import { requestsTurn } from './fake-acp-requests.ts';
import {
  createFakeSession,
  deleteFakeSession,
  legacySession,
  listFakeSessions,
  loadSessionAdvertised,
  newSessionId,
  readFakeSession,
  recordCancel,
  recordClose,
  recordMethod,
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

type FakeMode = [string, string, string | null, string | null];

const listedModes = JSON.parse(
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
) as FakeMode[] | Record<string, FakeMode[]>;

const fakeModes = Array.isArray(listedModes)
  ? listedModes
  : (listedModes[process.env.FAKE_ACP_PROVIDER ?? ''] ?? []);

const config: Record<string, string> = {
  mode: fakeModes.some(([id]) => id === 'agent') ? 'agent' : (fakeModes[0]?.[0] ?? 'agent'),
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
    size: Number(env.FAKE_ACP_WINDOW ?? 1_000_000),
    cost: { amount: 1.23, currency: 'USD' },
    _meta: { '_claude/model': 'claude-opus-5-5' },
  });
  await say(
    JSON.stringify({
      names,
      baseUrl: env.ANTHROPIC_BASE_URL ?? null,
      configDir: env.CLAUDE_CONFIG_DIR ?? null,
      token: env.ANTHROPIC_AUTH_TOKEN ? 'set' : 'missing',
      tokenLength: env.ANTHROPIC_AUTH_TOKEN?.length ?? 0,
      opus: env.ANTHROPIC_DEFAULT_OPUS_MODEL ?? null,
      sonnet: env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? null,
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

  await reportContext(sessionId, currentRequest(params.prompt), update);
  const commanded = await commandTurn(params.prompt, update, say);
  if (commanded) return commanded;
  if (text.includes('#silent')) return 'end_turn';
  const questioned = await questionTurn(text, client, sessionId, say);
  if (questioned) return questioned;
  const limited = await rateLimitTurn(text, update, say);
  if (limited) return limited;
  const windowed = await windowTurn(text, update, say, signal);
  if (windowed) return windowed;
  const requested = await requestsTurn(text, client, sessionRequest?.meta, say);
  if (requested) return requested;
  if (text.includes('#orphan ')) return orphanedCommandTurn(client, sessionId, text, signal);
  if (text.includes(BACKGROUND_TRIGGER)) return backgroundTurn(client, sessionId, text, say);
  if (text.includes(SLEEP_TRIGGER)) return sleepTurn(client, sessionId, text, say);
  if (text.includes(CYCLE_TRIGGER)) return ownFollowUpTurn(client, sessionId, say);
  if (text.includes(HANDBACK_TRIGGER)) return handbackTurn(client, sessionId, text, say);
  if (text.includes(LATER_TRIGGER)) return laterTurn(client, sessionId, text, say, sessionCwd);
  if (isTitleTrigger(text)) return titleTurn(text, client, sessionId, say);
  if (text.includes('#subagentswide')) return wideSubagentTurn(client, sessionId, say, signal);
  if (text.includes('#subagentsmodel')) return subagentModelTurn(client, sessionId, say);
  if (text.includes('#subagentsask')) return subagentAsksTurn(client, sessionId, say);
  if (text.includes('#subagents')) {
    return subagentsTurn(client, sessionId, say, text.includes('#subagentshold') ? signal : null);
  }
  if (text.includes('#recall')) {
    await say(
      `recall=${JSON.stringify(readFakeSession(sessionId).prompts)} blocks=${params.prompt.length}`,
    );
    return 'end_turn';
  }
  const sparked = await sparkTurn(text, sessionRequest, update, say);
  if (sparked) return sparked;
  const moded = await modeTurn({ text, config, options: configOptions, update, say, signal });
  if (moded) return moded;
  const fakeTurn = { text, sessionId, cwd: sessionCwd, client, update, say, signal };
  await railCrossings(fakeTurn).then(() => terminalCommands(fakeTurn));
  await floorTurn(fakeTurn, sessionRequest?.meta, config.mode ?? '');
  const published = await publishTurn(fakeTurn);
  if (published) return published;
  const asked = currentRequest(params.prompt);
  const planned = await planTurn(asked, fakeTurn, config.mode ?? '');
  if (planned) return planned;
  if (await planReplies(asked, say)) return 'end_turn';
  if (text.includes(FOUR_KINDS_TRIGGER)) return fourKindsTurn(sessionId, sessionCwd, client, say);
  if (text.includes('#signedout')) return signedOut(update, !text.includes('#signedoutquiet'));
  const built = await buildTurn(fakeTurn);
  if (built) return built;
  if (text.includes('#blocks')) return blocksTurn(params.prompt, say, signal, fakeTurn);
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
  if (text.includes('#auth')) throw acp.RequestError.authRequired();
  if (text.includes('#refuse')) return 'refusal';
  if (text.includes('#secret')) return leakSecrets(update, say);
  if (text.includes('#compacting')) return compactionTurn(update, say);
  if (text.includes('#twins') || text.includes('#hang') || text.includes('#diffs'))
    return eventsTurn(text, update, say, signal);
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
  const stalls = text.includes('#stall') && !text.includes('previous turn was interrupted');
  if (text.includes('#slow') || stalls) {
    for (let index = 0; ; index++) {
      await say(`word${index} `);
      await sleep(20, signal);
    }
  }
  const codexed = await codexTurn(fakeTurn, config.mode ?? '');
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
    recordMethod('initialize');
    clientCapabilities = ctx.params.clientCapabilities ?? null;
    return {
      protocolVersion: Number(process.env.FAKE_ACP_PROTOCOL_VERSION ?? acp.PROTOCOL_VERSION),
      agentCapabilities: {
        loadSession: loadSessionAdvertised,
        promptCapabilities,
        sessionCapabilities,
        ...fakeMcpCapabilities(),
      },
      agentInfo: FAKE_AGENT_INFO,
    };
  })
  .onRequest(acp.methods.agent.session.new, (ctx) => {
    recordMethod('session/new');
    sessionRequest = { meta: ctx.params._meta ?? null, mcpServers: ctx.params.mcpServers };
    sessionCwd = ctx.params.cwd;
    sessionDirectories = ctx.params.additionalDirectories ?? null;
    const sessionId = newSessionId();
    createFakeSession(sessionId, sessionCwd, sessionDirectories);
    pushAuthStatus(ctx.client);
    return process.env.FAKE_ACP_LEGACY
      ? legacySession(config)
      : { sessionId, configOptions: configOptions() };
  })
  .onRequest(acp.methods.agent.session.list, (ctx) => listFakeSessions(ctx.params.cwd ?? null))
  .onRequest(acp.methods.agent.session.resume, (ctx) => {
    recordMethod('session/resume');
    restoreConfig(ctx.params.sessionId, config);
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
    recordMethod('session/close');
    recordClose(ctx.params.sessionId);
    return {};
  })
  .onRequest(acp.methods.agent.session.delete, (ctx) => deleteFakeSession(ctx.params.sessionId))
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
    else rememberConfig(ctx.params.sessionId, config, configId, value);
    return { configOptions: configOptions() };
  })
  .onRequest(acp.methods.agent.session.prompt, async (ctx) => {
    const controller = new AbortController();
    pending.set(ctx.params.sessionId, controller);
    const text = ctx.params.prompt.map((block) => (block.type === 'text' ? block.text : ''));
    try {
      recordMethod('session/prompt');
      recordPrompt(ctx.params.sessionId, text.join(''));
      if (promptWouldFold())
        await new Promise((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error('stopped')));
        });
      const sessionId = ctx.params.sessionId;
      const refused = await rejectedTurn(text.join(''), config.model ?? '', (update) =>
        ctx.client.notify(acp.methods.client.session.update, { sessionId, update }),
      );
      if (refused) return refused;
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
    recordCancel(ctx.params.sessionId);
    pending.get(ctx.params.sessionId)?.abort();
  })
  .connect(
    acp.ndJsonStream(
      Writable.toWeb(process.stdout),
      Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
    ),
  );
