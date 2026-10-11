import { describe, expect, it } from 'vitest';
import { runNames } from './run-names.ts';

describe('the names of runs in the Changes pane', () => {
  it("names each run by its agent, never by a role, and counts an agent's later runs", () => {
    const runs = [{ provider: 'claude' }, { provider: 'codex' }, { provider: 'claude' }];
    expect(runNames(runs)).toEqual(['Claude', 'Codex', 'Claude 2']);
  });
});
