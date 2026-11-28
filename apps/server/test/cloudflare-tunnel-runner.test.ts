import { EventEmitter } from 'node:events';
import type { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { createTunnelRunner } from '../src/cloudflare/tunnel-runner.ts';

class FakeChild extends EventEmitter {
  readonly stderr = Object.assign(new EventEmitter(), { setEncoding: () => undefined });
  killed = false;
  stubborn = false;
  readonly signals: string[] = [];
  kill(signal = 'SIGTERM') {
    this.signals.push(signal);
    if (this.stubborn && signal !== 'SIGKILL') return true;
    this.killed = true;
    queueMicrotask(() => this.emit('exit', null));
    return true;
  }
}

function fakeSpawn() {
  const children: FakeChild[] = [];
  const envs: (NodeJS.ProcessEnv | undefined)[] = [];
  const launch = ((_bin: string, _args: string[], options: { env?: NodeJS.ProcessEnv }) => {
    const child = new FakeChild();
    children.push(child);
    envs.push(options.env);
    return child;
  }) as unknown as typeof spawn;
  return { children, envs, launch };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the Cloudflare tunnel runner', () => {
  it('passes the key in the environment and reports running once Cloudflare registers it', async () => {
    const { children, envs, launch } = fakeSpawn();
    const runner = createTunnelRunner({ bin: 'cloudflared', spawn: launch, readyMs: 500 });
    const started = runner.start('run-token');
    children[0]!.stderr.emit('data', 'INF Registered tunnel connection connIndex=0');
    expect(await started).toBe(true);
    expect(runner.state()).toBe('running');
    expect(envs[0]?.TUNNEL_TOKEN).toBe('run-token');
    runner.stop();
    expect(children[0]!.killed).toBe(true);
    expect(runner.state()).toBe('off');
  });

  it('stops a child that never connects and starts another', async () => {
    const { children, launch } = fakeSpawn();
    const runner = createTunnelRunner({
      bin: 'cloudflared',
      spawn: launch,
      readyMs: 20,
      retryMs: [10],
    });
    expect(await runner.start('run-token')).toBe(false);
    await wait(60);
    expect(children[0]!.killed).toBe(true);
    expect(children.length).toBeGreaterThan(1);
    runner.stop();
    const count = children.length;
    await wait(40);
    expect(children).toHaveLength(count);
  });

  it('force-stops a child that ignores the first stop, then starts another', async () => {
    const { children, launch } = fakeSpawn();
    const runner = createTunnelRunner({
      bin: 'cloudflared',
      spawn: launch,
      readyMs: 20,
      retryMs: [10],
      killGraceMs: 20,
    });
    const started = runner.start('run-token');
    children[0]!.stubborn = true;
    expect(await started).toBe(false);
    await wait(100);
    expect(children[0]!.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(children.length).toBeGreaterThan(1);
    runner.stop();
  });
});
