import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sparkModTelemetryScript } from './native-mod-telemetry-script.ts';

export const MOD_POLL_MS = 1_000;
const MOD_STOP_WAIT_MS = 2_000;
export const MOD_NAME = 'spark-outpost';
const FIRST_MOD_VERSION = [2, 1, 287] as const;

export function supportsMods(version: string): boolean {
  const parts = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!parts) return false;
  for (const [index, minimum] of FIRST_MOD_VERSION.entries()) {
    const part = Number(parts[index + 1]);
    if (part !== minimum) return part > minimum;
  }
  return true;
}

export function sparkModScript(): string {
  return String.raw`
import { fromEngine, telemetry } from './telemetry.js';

const POLL_MS = ${MOD_POLL_MS};
const STOP_WAIT_MS = ${MOD_STOP_WAIT_MS};
const SEND_ROUNDS = 10;
const NOT_SENT = 'Spark: a message from your phone was not sent. Type it here instead.';

function strings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

export function readInbox(text) {
  const inbox = JSON.parse(text);
  if (!inbox || typeof inbox !== 'object')
    return { messages: [], notices: [], status: null, record: null };
  return {
    messages: strings(inbox.messages),
    notices: strings(inbox.notices),
    status: typeof inbox.status === 'string' ? inbox.status : null,
    record: typeof inbox.record === 'boolean' ? inbox.record : null,
  };
}

function sent(response) {
  if (response.ok) return true;
  return response.status >= 400 && response.status < 500 && ![401, 413].includes(response.status);
}

async function readCost($) {
  try {
    const usage = await $.session.usage();
    return usage.cost ? usage.cost.usd : null;
  } catch {
    return null;
  }
}

function costed($, link) {
  const read = link.reads.then(async () => link.facts.cost(await readCost($)));
  link.reads = read.then(() => undefined);
  return read;
}

async function readConfig($, link) {
  if (link.config) return link.config;
  link.config = JSON.parse(await $.fs.read($.plugin.root + '/../observer.json'));
  if (!link.told) link.facts.record(link.config.record === true);
  return link.config;
}

async function sendFacts($, link) {
  const config = await readConfig($, link);
  for (let round = 0; round < SEND_ROUNDS; round++) {
    const items = link.facts.take(link.single ? 1 : undefined);
    if (items.length === 0) return;
    const answer = await $.http
      .fetch(new URL('/mod/telemetry', config.url).href, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token },
        body: JSON.stringify({ items }),
      })
      .catch(() => null);
    if (answer && sent(answer)) {
      link.single = false;
      continue;
    }
    if (answer && answer.status === 413) {
      if (items.length === 1) continue;
      link.single = true;
    }
    link.facts.putBack(items);
    if (!answer || answer.status === 401) link.config = null;
    return;
  }
}

function deliver($, link) {
  const run = link.sending.then(() => sendFacts($, link));
  link.sending = run.catch(() => {
    link.config = null;
  });
  return run;
}

export function register(on) {
  let line = null;
  const link = {
    facts: telemetry(),
    config: null,
    told: false,
    sending: Promise.resolve(),
    reads: Promise.resolve(),
    single: false,
  };
  const facts = link.facts;
  on('classic.UserPromptSubmit', async ($, e, next) => {
    facts.prompted(e.prompt_id);
    return next(e);
  }).catch(($, e, next) => next(e));
  on('classic.PermissionRequest', async ($, e, next) => {
    facts.asked(e.tool_name, e.tool_input);
    return next(e);
  }).catch(($, e, next) => next(e));
  on('classic.Stop', async ($, e, next) => {
    if (facts.recording())
      await Promise.race([deliver($, link).catch(() => undefined), $.clock.sleep(STOP_WAIT_MS)]);
    return next(e);
  }).catch(($, e, next) => next(e));
  on('turn.start', async ($, e, next) => {
    if (!fromEngine(next.origin)) return next(e);
    if (!e.agentId && facts.idle()) facts.between(await costed($, link));
    facts.turnStarted(e, Math.round(await $.clock.now()));
    if (facts.recording() && !e.agentId)
      await Promise.race([deliver($, link).catch(() => undefined), $.clock.sleep(STOP_WAIT_MS)]);
    return next(e);
  });
  on('turn.step', async function* ($, e, next) {
    if (fromEngine(next.origin)) facts.stepping(e);
    const result = yield* next(e);
    if (!fromEngine(next.origin)) return result;
    facts.answered(e, result.answer);
    if (result.usage) facts.stepped(e, result.usage, await costed($, link));
    return result;
  });
  on('turn.complete', async ($, e, next) => {
    if (fromEngine(next.origin)) facts.turnEnded(e, Math.round(await $.clock.now()));
    return next(e);
  });
  on('tool.call', async ($, e, next) => {
    const watched = fromEngine(next.origin);
    if (watched) facts.toolStarted(e, Math.round(await $.clock.now()));
    const result = await next(e);
    if (watched) facts.toolEnded(e, result, Math.round(await $.clock.now()));
    return result;
  }).catch(($, e, next) => next(e));
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (line === null || e.props.hasSurvey) return next(e);
    const { Text } = $.ui.resolve(e);
    return h(Text, { dimColor: true, wrap: 'truncate-end' }, line);
  });
  on('session.start', async ($, e, next) => {
    await costed($, link);
    await readConfig($, link).catch(() => undefined);
    let busy = false;
    const show = (text) => {
      if (text === line) return;
      line = text;
      $.ui.invalidate('ui.render');
    };
    const submit = (text) => {
      $.prompt.submit({ text, asUser: true }).then(
        (result) => {
          if (result && 'drop' in result) $.ui.log(NOT_SENT);
        },
        () => $.ui.log(NOT_SENT),
      );
    };
    const poll = async () => {
      if (facts.idle()) facts.between(await costed($, link));
      const config = await readConfig($, link);
      const response = await $.http.fetch(new URL('/mod/inbox', config.url).href, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token },
        body: '{}',
      });
      if (!response.ok) throw new Error('Spark refused the inbox request.');
      const inbox = readInbox(response.text);
      if (inbox.record !== null) {
        link.told = true;
        facts.record(inbox.record);
      }
      show(inbox.status);
      for (const notice of inbox.notices) $.ui.log(notice);
      for (const text of inbox.messages) submit(text);
      await deliver($, link);
    };
    $.clock.every(POLL_MS, async () => {
      if (busy) return;
      busy = true;
      try {
        await poll();
      } catch {
        link.config = null;
        show(null);
      } finally {
        busy = false;
      }
    });
    return next(e);
  });
}
`;
}

export async function writeSparkMod(directory: string): Promise<string> {
  const root = join(directory, 'mod');
  await mkdir(join(root, '.claude-plugin'), { recursive: true, mode: 0o700 });
  await mkdir(join(root, 'hooks'), { mode: 0o700 });
  const files: [string, string][] = [
    [
      '.claude-plugin/plugin.json',
      JSON.stringify({
        name: MOD_NAME,
        version: '1.0.0',
        description:
          'Spark Outpost: messages from your paired phone, its status line, and turn usage for Spark.',
        author: { name: 'Spark Outpost' },
      }),
    ],
    ['hooks/hooks.json', JSON.stringify({ modules: ['./register.js'] })],
    ['hooks/register.js', sparkModScript()],
    ['hooks/telemetry.js', sparkModTelemetryScript()],
  ];
  for (const [path, text] of files)
    await writeFile(join(root, path), text, { mode: 0o600, flag: 'wx' });
  return root;
}
