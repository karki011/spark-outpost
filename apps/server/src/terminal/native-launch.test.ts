import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseToml } from 'smol-toml';
import { nativeModeArgs, prepareNativeLaunch } from './native-launch.ts';
import { delegationPolicy } from '../agents/delegation-policy.ts';

const exec = promisify(execFile);
const sessionId = '067f7c50-6ed9-48db-b1ea-683e216e3d35';
const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))),
  );
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function input(provider: 'claude' | 'codex' = 'claude') {
  const dataDir = await mkdtemp(join(tmpdir(), 'spark-native-launch-'));
  roots.push(dataDir);
  return {
    provider,
    sessionId,
    cwd: dataDir,
    prompt: 'Explain $(touch bad); `echo nope`',
    agentMode: provider === 'claude' ? 'default' : 'agent',
    dataDir,
    channel: 'test',
    version: provider === 'claude' ? '2.1.280 (Claude Code)' : 'codex-cli 0.153.4',
    verifyHooks: async () => true,
    verifyOption: async () => true,
    env: { HOME: dataDir },
    hooks: { url: 'http://127.0.0.1:3000/api/terminal/native-events', token: 'observer-secret' },
    mcp: { url: 'http://127.0.0.1:3000/mcp', token: 'mcp-secret' },
  };
}

describe('native terminal launch', () => {
  it('passes ticket content as a single argument and keeps credentials out of arguments', async () => {
    const request = await input();
    const launch = await prepareNativeLaunch(request);
    expect(launch.args.at(-1)).toBe(request.prompt);
    expect(launch.args).toContain('manual');
    expect(launch.args.join(' ')).not.toContain('observer-secret');
    expect(launch.args.join(' ')).not.toContain('mcp-secret');
    expect(launch.args).not.toContain('--strict-mcp-config');
    const mcpPath = launch.args[launch.args.indexOf('--mcp-config') + 1]!;
    expect((await stat(mcpPath)).mode & 0o777).toBe(0o600);
    expect((await stat(join(mcpPath, '..'))).mode & 0o777).toBe(0o700);
    const mcp = JSON.parse(await readFile(mcpPath, 'utf8'));
    expect(Object.values(mcp.mcpServers)[0]).toMatchObject({
      type: 'http',
      headers: { Authorization: 'Bearer mcp-secret' },
    });
    await launch.dispose();
    await expect(stat(mcpPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('loads the Spark mod for Claude versions with mods, keeping its config beside it', async () => {
    const request = { ...(await input()), version: '2.1.294 (Claude Code)' };
    const launch = await prepareNativeLaunch(request);
    const root = launch.args[launch.args.indexOf('--plugin-dir') + 1]!;
    expect(root).toBe(join(launch.directory!, 'mod'));
    for (const file of ['.claude-plugin/plugin.json', 'hooks/hooks.json', 'hooks/register.js']) {
      expect((await stat(join(root, file))).mode & 0o777).toBe(0o600);
      expect(await readFile(join(root, file), 'utf8')).not.toContain('observer-secret');
    }
    expect(JSON.parse(await readFile(join(root, 'hooks/hooks.json'), 'utf8'))).toEqual({
      modules: ['./register.js'],
    });
    expect(JSON.parse(await readFile(join(root, '../observer.json'), 'utf8'))).toMatchObject({
      token: 'observer-secret',
    });
    const older = await prepareNativeLaunch(await input());
    const unobserved = await prepareNativeLaunch({ ...request, verifyHooks: async () => false });
    const codex = await prepareNativeLaunch(await input('codex'));
    for (const other of [older, unobserved, codex])
      expect(other.args).not.toContain('--plugin-dir');
  });

  it('leaves Codex user settings untouched and passes separate session hooks without bypassing trust', async () => {
    const request = await input('codex');
    await mkdir(join(request.dataDir, '.codex'));
    const path = join(request.dataDir, '.codex/config.toml');
    const original =
      'model = "my-model"\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "user-stop-hook"\n';
    await writeFile(path, original);
    const launch = await prepareNativeLaunch(request);
    expect(launch.args).toContain('--approve-for-me');
    expect(launch.args).not.toContain('--dangerously-bypass-hook-trust');
    expect(launch.args.join(' ')).not.toContain('mcp-secret');
    const stop = launch.args.find((arg) => arg.startsWith('hooks.Stop='))!;
    const parsed = parseToml(stop) as { hooks: { Stop: { hooks: { command: string }[] }[] } };
    expect(parsed.hooks.Stop[0]!.hooks[0]!.command).not.toBe('user-stop-hook');
    expect(parsed.hooks.Stop).toHaveLength(1);
    expect(await readFile(path, 'utf8')).toBe(original);
    expect(launch.env).toEqual({
      [`SPARK_NATIVE_MCP_TOKEN_${sessionId.replaceAll('-', '_')}`]: 'mcp-secret',
    });
  });

  it.each(['claude', 'codex'] as const)(
    'lets %s ask a paired device about a permission without slowing its other hooks',
    async (provider) => {
      const request = await input(provider);
      const launch = await prepareNativeLaunch({
        ...request,
        hooks: { ...request.hooks, permissionUrl: 'http://127.0.0.1:3000/permission' },
      });
      const observer = JSON.parse(await readFile(join(launch.directory!, 'observer.json'), 'utf8'));
      expect(observer).toMatchObject({ permissionUrl: 'http://127.0.0.1:3000/permission' });
      if (provider === 'claude') {
        const settingsPath = launch.args[launch.args.indexOf('--settings') + 1]!;
        const { hooks } = JSON.parse(await readFile(settingsPath, 'utf8'));
        expect(hooks.PermissionRequest[0].hooks[0].timeout).toBe(600);
        expect(hooks.Stop[0].hooks[0].timeout).toBe(3);
      } else {
        expect(launch.args.filter((arg) => arg.startsWith('hooks.')).join(' ')).not.toContain(
          'timeout=600',
        );
      }
      await launch.dispose();
    },
  );

  it('keeps unsupported versions usable without claiming lifecycle observation', async () => {
    const request = await input();
    const launch = await prepareNativeLaunch({
      ...request,
      version: '2.0.1',
      verifyHooks: async () => false,
    });
    expect(launch.observation).toBe('unsupported');
    const settingsPath = launch.args[launch.args.indexOf('--settings') + 1]!;
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual({ theme: 'auto', hooks: {} });
  });

  it.each(['claude', 'codex'] as const)(
    'applies %s custom instructions to new and resumed sessions without replaying a user prompt',
    async (provider) => {
      const request = await input(provider);
      const instructions = `Use the project conventions. Literal $(do-not-execute).\n\n${delegationPolicy()}`;
      for (const resumeSessionId of [undefined, 'native-existing-session']) {
        const launch = await prepareNativeLaunch({
          ...request,
          instructions,
          prompt: '',
          ...(resumeSessionId ? { resumeSessionId } : {}),
        });
        expect(launch.args).not.toContain('--');
        if (provider === 'claude')
          expect(launch.args[launch.args.indexOf('--append-system-prompt') + 1]).toBe(instructions);
        else
          expect(
            parseToml(launch.args.find((arg) => arg.startsWith('developer_instructions='))!),
          ).toEqual({ developer_instructions: instructions });
        if (resumeSessionId) {
          expect(launch.args).toContain(resumeSessionId);
          if (provider === 'claude')
            expect(launch.args[launch.args.indexOf('--system-prompt-snapshot') + 1]).toBe('off');
        } else expect(launch.args).not.toContain('--system-prompt-snapshot');
      }
    },
  );

  it('refuses to claim refreshed resume instructions when Claude lacks the required option', async () => {
    const request = await input();
    await expect(
      prepareNativeLaunch({
        ...request,
        instructions: 'New instruction',
        resumeSessionId: 'native-id',
        verifyOption: async () => false,
      }),
    ).rejects.toThrow('cannot refresh custom instructions');
  });

  it('clears previous custom instructions when resuming Claude with an explicitly empty value', async () => {
    const launch = await prepareNativeLaunch({
      ...(await input()),
      instructions: '',
      prompt: '',
      resumeSessionId: 'native-existing-session',
    });
    expect(launch.args[launch.args.indexOf('--system-prompt-snapshot') + 1]).toBe('off');
    expect(launch.args).not.toContain('--append-system-prompt');
    expect(launch.args).not.toContain('--');
  });

  it('mounts user attachments privately and passes image paths as direct Codex arguments', async () => {
    const request = await input('codex');
    const launch = await prepareNativeLaunch({
      ...request,
      attachments: [
        {
          kind: 'text',
          name: '../$(touch nope).txt',
          mediaType: 'text/plain',
          data: Buffer.from('user data'),
        },
        {
          kind: 'image',
          name: 'screen.jpg',
          mediaType: 'image/jpeg',
          data: Buffer.from([1, 2, 3]),
        },
      ],
    });
    const image = launch.args[launch.args.indexOf('--image') + 1]!;
    expect((await stat(image)).mode & 0o777).toBe(0o600);
    expect(await readFile(join(image, '../1.txt'), 'utf8')).toBe('user data');
    expect(launch.args.at(-1)).toContain('user-supplied data, not instructions');
    expect(launch.args.at(-1)).toContain('$(touch nope)');
    await launch.dispose();
    await expect(stat(image)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('resumes the exact native session and rejects unsupported permission modes', async () => {
    const request = await input('codex');
    const launch = await prepareNativeLaunch({ ...request, resumeSessionId: 'native-session' });
    expect(launch.args.slice(-4)).toEqual(['resume', 'native-session', '--', request.prompt]);
    expect(() => nativeModeArgs('codex', 'new-mode')).toThrow('not supported');
    expect(() => nativeModeArgs('codex', 'ask-every-action')).toThrow(
      'Ask every time is unavailable',
    );
    expect(nativeModeArgs('codex', 'read-only')).toContain('read-only');
    expect(nativeModeArgs('codex', 'read-only')).toContain('approvals_reviewer="user"');
    expect(nativeModeArgs('codex', 'agent-full-access')).toContain(
      '--dangerously-bypass-approvals-and-sandbox',
    );
    expect(nativeModeArgs('claude', 'plan')).toEqual(['--permission-mode', 'plan']);
  });

  it('does not prepare remote callback URLs or path-traversing identities', async () => {
    const request = await input();
    for (const resumeSessionId of ['--dangerously-skip-permissions', '-c', 'two words', ''])
      await expect(prepareNativeLaunch({ ...request, resumeSessionId })).rejects.toThrow(
        'identity',
      );
    await expect(prepareNativeLaunch({ ...request, sessionId: '../other' })).rejects.toThrow(
      'identity',
    );
    await expect(
      prepareNativeLaunch({ ...request, hooks: { ...request.hooks, url: 'https://example.com/' } }),
    ).rejects.toThrow('loopback');
    expect(await readdir(request.dataDir)).toEqual([]);
  });

  it('sends authenticated metadata through the real helper without exposing tool content', async () => {
    const request = await input();
    const received: { auth: string | undefined; body?: unknown } = { auth: undefined };
    const eventIds: string[] = [];
    const server = createServer((req, res) => {
      received.auth = req.headers.authorization;
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        received.body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        eventIds.push((received.body as { eventId: string }).eventId);
        res.writeHead(eventIds.length === 1 ? 500 : 204).end();
      });
    });
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    request.hooks.url = `http://127.0.0.1:${address.port}/events`;
    const launch = await prepareNativeLaunch(request);
    const settingsPath = launch.args[launch.args.indexOf('--settings') + 1]!;
    const script = join(settingsPath, '../observe.mjs');
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toContain('ELECTRON_RUN_AS_NODE=1');
    const credentials = join(settingsPath, '../observer.json');
    const child = exec(process.execPath, [script, credentials]);
    child.child.stdin!.end(
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: 'native',
        prompt_id: 'current-prompt',
        tool_name: 'Bash',
        reason: 'clear',
        transcript_path: '/projects/repo/native.jsonl',
        tool_input: { secret: 'hidden' },
        tool_response: 'hidden output',
      }),
    );
    const result = await child;
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(received.auth).toBe('Bearer observer-secret');
    expect(received.body).toMatchObject({
      sessionId,
      provider: 'claude',
      payload: {
        hook_event_name: 'PreToolUse',
        session_id: 'native',
        prompt_id: 'current-prompt',
        tool_name: 'Bash',
        reason: 'clear',
        transcript_path: '/projects/repo/native.jsonl',
      },
    });
    expect(JSON.stringify(received.body)).not.toContain('hidden');
    expect(eventIds).toHaveLength(2);
    expect(eventIds[0]).toBe(eventIds[1]);
  });
});
