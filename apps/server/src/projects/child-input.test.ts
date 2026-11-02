import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { sendInput } from './child-input.ts';

it('survives a command that stops reading its input and exits', async () => {
  const child = spawn('sh', ['-c', 'exec 0<&-; sleep 0.1; exit 3']);
  const closed = once(child, 'close');
  sendInput(child, 'x'.repeat(1_000_000));
  const [code] = await closed;
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(code).toBe(3);
});
