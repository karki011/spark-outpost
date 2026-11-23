import { describe, expect, it } from 'vitest';
import { firstAnswer } from './fallback.ts';

describe('firstAnswer', () => {
  it('moves to the next connection when one fails and stops at the first answer', async () => {
    const asked: string[] = [];
    const found = await firstAnswer(['gh_cli', 'app', 'token'], (connection) => {
      asked.push(connection);
      return connection === 'gh_cli'
        ? Promise.reject(new Error('GitHub had a server error (502)'))
        : Promise.resolve(`${connection} body`);
    });
    expect(found).toEqual({ connection: 'app', answer: 'app body' });
    expect(asked).toEqual(['gh_cli', 'app']);
  });

  it('reports the last failure when every connection fails', async () => {
    await expect(
      firstAnswer(['gh_cli', 'app'], (connection) =>
        Promise.reject(new Error(`${connection} failed`)),
      ),
    ).rejects.toThrow('app failed');
    await expect(firstAnswer([], () => Promise.resolve(1))).rejects.toThrow(/No GitHub connection/);
  });
});
