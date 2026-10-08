import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeHookNames } from './native-hooks.ts';
import {
  supportsNativeHookEvents,
  verifyNativeHooks,
  verifyNativeOption,
} from './native-capabilities.ts';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture(source: string) {
  const root = await mkdtemp(join(tmpdir(), 'spark-hook-capabilities-test-'));
  roots.push(root);
  const command = join(root, 'native-cli');
  const update = (code: string) =>
    writeFile(command, `#!${process.execPath}\n${code}\n`, { mode: 0o700 });
  await update(source);
  return { command, root, update };
}
const doctor = (events = nativeHookNames('claude'), additional = '') =>
  `process.stdout.write(${JSON.stringify(`Invalid settings\n- probe › hooks.SparkCapabilityProbe: Unknown hook event. Valid events: ${events.join(', ')}\n${additional}`)});`;

describe('installed native hook capabilities', () => {
  it('verifies resume snapshot support from the installed help and caches each check per version', async () => {
    const cli = await fixture(
      'process.stdout.write("Usage: claude --system-prompt-snapshot <on|off>\\n");',
    );
    expect(await verifyNativeOption(cli.command, '2.1.294', '--system-prompt-snapshot')).toBe(true);
    await cli.update('process.exit(1);');
    expect(await verifyNativeOption(cli.command, '2.1.294', '--system-prompt-snapshot')).toBe(true);
    expect(await verifyNativeOption(cli.command, '2.1.295', '--system-prompt-snapshot')).toBe(
      false,
    );
    await cli.update('process.stdout.write("--system-prompt-snapshot <on|off>\\n");');
    expect(await verifyNativeOption(cli.command, '2.1.295', '--system-prompt-snapshot')).toBe(
      false,
    );
    expect(await verifyNativeOption(cli.command, '2.1.296', '--system-prompt-snapshot')).toBe(true);
  });
  it('accepts compatible patch drift by validated schema and caches results per binary version', async () => {
    const cli = await fixture(doctor());
    expect(await verifyNativeHooks('claude', cli.command, '2.1.294')).toBe(true);
    await cli.update(doctor(['Stop']));
    expect(await verifyNativeHooks('claude', cli.command, '2.1.294')).toBe(true);
    expect(await verifyNativeHooks('claude', cli.command, '2.1.295')).toBe(false);
    await cli.update(doctor());
    expect(await verifyNativeHooks('claude', cli.command, '2.1.295')).toBe(false);
    expect(await verifyNativeHooks('claude', cli.command, '2.1.296')).toBe(true);
  });

  it('rejects a missing event or changed hook handler schema', async () => {
    const cli = await fixture(
      doctor(nativeHookNames('claude'), '- probe › hooks.Stop: Invalid handler\n'),
    );
    expect(await verifyNativeHooks('claude', cli.command, 'future')).toBe(false);
    await cli.update(doctor(['SessionStart', 'Stop']));
    expect(await verifyNativeHooks('claude', cli.command, 'future-b')).toBe(false);
    await cli.update(doctor());
    expect(await verifyNativeHooks('claude', cli.command, 'future-c')).toBe(true);
    expect(
      supportsNativeHookEvents(
        'codex',
        nativeHookNames('codex').map((name) => name.toLowerCase()),
      ),
    ).toBe(true);
  });

  it('does not repeat a failed diagnostic until the CLI version changes', async () => {
    const cli = await fixture('process.exit(1);');
    expect(await verifyNativeHooks('claude', cli.command, 'future')).toBe(false);
    await cli.update(doctor());
    expect(await verifyNativeHooks('claude', cli.command, 'future')).toBe(false);
    expect(await verifyNativeHooks('claude', cli.command, 'future-next')).toBe(true);
  });

  it('cancels its own diagnostic process and retries successfully later', async () => {
    const cli = await fixture('');
    const marker = join(cli.root, 'started');
    await cli.update(
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'ready'); setInterval(() => {}, 1000);`,
    );
    const controller = new AbortController();
    const checking = verifyNativeHooks('claude', cli.command, 'future', controller.signal);
    await vi.waitFor(async () => expect(await readFile(marker, 'utf8')).toBe('ready'));
    controller.abort();
    expect(await checking).toBe(false);
    await cli.update(doctor());
    expect(await verifyNativeHooks('claude', cli.command, 'future')).toBe(true);
  });

  it('verifies enabled session hook registrations through Codex JSON RPC without a provider turn', async () => {
    const hooks = nativeHookNames('codex').map((eventName) => ({
      eventName,
      source: 'sessionFlags',
      enabled: true,
    }));
    const cli = await fixture(`import { createInterface } from 'node:readline';
      createInterface({ input: process.stdin }).on('line', line => {
        const message = JSON.parse(line);
        if (message.id === 1) process.stdout.write(JSON.stringify({id:1,result:{}})+'\\n');
        if (message.id === 2) process.stdout.write(JSON.stringify({id:2,result:{data:[{hooks:${JSON.stringify(hooks)},errors:[]}]}})+'\\n');
      });`);
    expect(await verifyNativeHooks('codex', cli.command, 'future')).toBe(true);
  });
});
