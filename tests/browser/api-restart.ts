import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type APIRequestContext } from '@playwright/test';
import { API_PORT, API_RESTART_FLAG } from './stub-config.ts';

export function killApi(): void {
  mkdirSync(path.dirname(API_RESTART_FLAG), { recursive: true });
  writeFileSync(API_RESTART_FLAG, '');
  const pid = execFileSync('lsof', ['-ti', `tcp:${API_PORT}`, '-sTCP:LISTEN'], {
    encoding: 'utf8',
  });
  process.kill(Number(pid.trim().split('\n')[0]), 'SIGKILL');
}

export async function restartApi(request: APIRequestContext): Promise<void> {
  killApi();
  await expect
    .poll(async () => (await request.get('/api/health').catch(() => null))?.ok() ?? false, {
      timeout: 60_000,
    })
    .toBe(true);
}
