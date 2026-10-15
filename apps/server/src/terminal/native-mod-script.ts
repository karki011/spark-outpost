import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sparkModTelemetryScript } from './native-mod-telemetry-script.ts';

export const MOD_POLL_MS = 1_000;
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
const SEND_ROUNDS = 10;
const NOT_SENT = 'Spark: a message from your phone was not sent. Type it here instead.';

function strings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

export function readInbox(text) {
  const inbox = JSON.parse(text);
  if (!inbox || typeof inbox !== 'object') return { messages: [], notices: [], status: null };
  return {
    messages: strings(inbox.messages),
    notices: strings(inbox.notices),
    status: typeof inbox.status === 'string' ? inbox.status : null,
  };
}

async function readCost($) {
  try {
    const usage = await $.session.usage();
    return usage.cost ? usage.cost.usd : null;
  } catch {
    return null;
  }
}

function costed($, ledger) {
  const read = ledger.reads.then(async () => ledger.facts.cost(await readCost($)));
  ledger.reads = read.then(() => undefined);
  return read;
}

function sent(response) {
  return response.ok || (response.status >= 400 && response.status < 500 && response.status !== 401);
}

export function register(on) {
  let line = null;
  const facts = telemetry();
  const ledger = { facts, reads: Promise.resolve() };
  on('classic.UserPromptSubmit', async ($, e, next) => {
    facts.prompted(e.prompt_id);
    return next(e);
  }).catch(($, e, next) => next(e));
  on('turn.start', async ($, e, next) => {
    if (!fromEngine(next.origin)) return next(e);
    if (!e.agentId && !facts.working()) facts.between(await costed($, ledger));
    facts.turnStarted(e, Math.round(await $.clock.now()));
    return next(e);
  });
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e);
    if (result.usage && fromEngine(next.origin)) facts.stepped(e, result.usage, await costed($, ledger));
    return result;
  });
  on('turn.complete', async ($, e, next) => {
    if (fromEngine(next.origin)) facts.turnEnded(e, Math.round(await $.clock.now()));
    return next(e);
  });
  on('tool.call', async ($, e, next) => {
    const watched = fromEngine(next.origin);
    if (watched) facts.tool(e, 'start', false, Math.round(await $.clock.now()));
    const result = await next(e);
    const failed = Boolean(result && (result.isError || result.deny));
    if (watched) facts.tool(e, 'end', failed, Math.round(await $.clock.now()));
    return result;
  }).catch(($, e, next) => next(e));
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (line === null || e.props.hasSurvey) return next(e);
    const { Text } = $.ui.resolve(e);
    return h(Text, { dimColor: true, wrap: 'truncate-end' }, line);
  });
  on('session.start', async ($, e, next) => {
    await costed($, ledger);
    let config = null;
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
      if (!facts.working()) facts.between(await costed($, ledger));
      config ??= JSON.parse(await $.fs.read($.plugin.root + '/../observer.json'));
      const response = await $.http.fetch(new URL('/mod/inbox', config.url).href, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token },
        body: '{}',
      });
      if (!response.ok) throw new Error('Spark refused the inbox request.');
      const inbox = readInbox(response.text);
      show(inbox.status);
      for (const notice of inbox.notices) $.ui.log(notice);
      for (const text of inbox.messages) submit(text);
      for (let round = 0; round < SEND_ROUNDS; round++) {
        const items = facts.take();
        if (items.length === 0) return;
        const answer = await $.http
          .fetch(new URL('/mod/telemetry', config.url).href, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token },
            body: JSON.stringify({ items }),
          })
          .catch(() => null);
        if (answer && sent(answer)) continue;
        facts.putBack(items);
        if (!answer || answer.status === 401) config = null;
        return;
      }
    };
    $.clock.every(POLL_MS, async () => {
      if (busy) return;
      busy = true;
      try {
        await poll();
      } catch {
        config = null;
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
