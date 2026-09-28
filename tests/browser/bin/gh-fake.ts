import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const state = process.env.FAKE_GH_STATE;
const login = state && existsSync(state) ? readFileSync(state, 'utf8').trim() : '';

function fail(message: string, code = 1): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function option(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function fields(): Record<string, string | boolean | number> {
  const body: Record<string, string | boolean | number> = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag !== '-f' && flag !== '-F') continue;
    const pair = args[index + 1] ?? '';
    const at = pair.indexOf('=');
    const key = pair.slice(0, at);
    const value = pair.slice(at + 1);
    if (flag === '-f') body[key] = value;
    else if (value === 'true' || value === 'false') body[key] = value === 'true';
    else body[key] = Number.isNaN(Number(value)) ? value : Number(value);
  }
  return body;
}

function apiPath(): string {
  const skip = new Set(['--hostname', '-X', '-f', '-F']);
  for (let index = 1; index < args.length; index += 1) {
    if (skip.has(args[index]!)) {
      index += 1;
      continue;
    }
    return args[index]!;
  }
  return fail('fake gh: no API path');
}

async function api() {
  if (!login) fail('To get started with GitHub CLI, please run:  gh auth login', 4);
  const base = process.env.FAKE_GH_API ?? fail('fake gh: FAKE_GH_API is not set');
  const method = option('-X') ?? 'GET';
  const body = fields();
  const response = await fetch(`${base}/${apiPath().replace(/^\//, '')}`, {
    method,
    headers: { 'x-fake-gh': login, 'content-type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });
  process.stdout.write(await response.text());
  if (!response.ok) fail(`gh: ${response.statusText} (HTTP ${response.status})`);
}

const [command, subcommand] = args;
if (command === '--version') {
  process.stdout.write('gh version 2.80.0 (2026-09-01)\n');
} else if (command === 'auth' && subcommand === 'status') {
  if (!login) fail('You are not logged into any GitHub hosts. To log in, run: gh auth login');
  process.stdout.write(
    `${option('--hostname') ?? 'github.com'}\n  ✓ Logged in to account ${login}\n`,
  );
} else if (command === 'api') {
  await api();
} else {
  fail(`fake gh does not support: ${args.join(' ')}`, 2);
}
