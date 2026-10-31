import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { isAlive, processTable } from '../../terminal/process-group.ts';
import { startAgentProcess, type AgentProcess } from './agent-process.ts';

const STRAY_JOB = 'set -m; sleep 300 & echo "job $!" >&2; wait';

async function until<T>(read: () => T | null | Promise<T | null>): Promise<T> {
  for (let tries = 0; tries < 250; tries += 1) {
    const value = await read();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('timed out');
}

function forceKill(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    return;
  }
}

async function agentWithJob(): Promise<{ agent: AgentProcess; root: number; job: number }> {
  const agent = startAgentProcess({ command: '/bin/sh', args: ['-c', STRAY_JOB] }, tmpdir(), {
    PATH: '/usr/bin:/bin',
  });
  agent.exited.catch(() => undefined);
  const job = await until(() => {
    const match = /job (\d+)/.exec(agent.stderrTail());
    return match ? Number(match[1]) : null;
  });
  const root = await until(
    async () => (await processTable()).find((row) => row.pid === job)?.ppid ?? null,
  );
  return { agent, root, job };
}

async function gone(pid: number): Promise<boolean> {
  return until(() => (isAlive(pid) ? null : true)).catch(() => false);
}

describe('stopping an agent process', () => {
  it('ends the agent and a job it started in its own process group', async () => {
    const { agent, root, job } = await agentWithJob();
    try {
      agent.stopping();
      await agent.kill();
      expect(await gone(job)).toBe(true);
      expect(await gone(root)).toBe(true);
    } finally {
      forceKill(job);
      forceKill(root);
    }
  });

  it('ends a job seen at the stop even when the agent has already exited', async () => {
    const { agent, root, job } = await agentWithJob();
    try {
      agent.stopping();
      await new Promise((resolve) => setTimeout(resolve, 100));
      forceKill(root);
      await agent.exited.catch(() => undefined);
      expect(isAlive(job)).toBe(true);
      await agent.kill();
      expect(await gone(job)).toBe(true);
    } finally {
      forceKill(job);
    }
  });

  it('kills once however often it is asked', async () => {
    const { agent, root, job } = await agentWithJob();
    try {
      const first = agent.kill();
      expect(agent.kill()).toBe(first);
      await first;
      expect(await gone(job)).toBe(true);
    } finally {
      forceKill(job);
      forceKill(root);
    }
  });
});
