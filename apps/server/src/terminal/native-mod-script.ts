import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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
const POLL_MS = ${MOD_POLL_MS};
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

export function register(on) {
  let line = null;
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (line === null || e.props.hasSurvey) return next(e);
    const { Text } = $.ui.resolve(e);
    return h(Text, { dimColor: true, wrap: 'truncate-end' }, line);
  });
  on('session.start', ($, e, next) => {
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
        description: 'Spark Outpost: messages from your paired phone and its status line.',
        author: { name: 'Spark Outpost' },
      }),
    ],
    ['hooks/hooks.json', JSON.stringify({ modules: ['./register.js'] })],
    ['hooks/register.js', sparkModScript()],
  ];
  for (const [path, text] of files)
    await writeFile(join(root, path), text, { mode: 0o600, flag: 'wx' });
  return root;
}
