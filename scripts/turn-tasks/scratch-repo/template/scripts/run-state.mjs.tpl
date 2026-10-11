import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

const folder = join(process.cwd(), '.run');

export function token() {
  return randomBytes(4).toString('hex');
}

export function secondsFlag(fallback) {
  const flag = process.argv.find((argument) => argument.startsWith('--seconds='));
  const seconds = flag ? Number(flag.slice('--seconds='.length)) : fallback;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : fallback;
}

export async function record(name, value) {
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, name), `${JSON.stringify(value, null, 2)}\n`);
}

export function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}
