import { describe, expect, it } from 'vitest';
import type { ProviderOutput } from '../providers/provider.ts';
import { createLoopGuard } from './loop-guard.ts';

const call = (name: string, toolKind = 'read', target?: string): ProviderOutput => ({
  kind: 'step_started',
  name,
  tool: true,
  toolKind,
  ...(target ? { target } : {}),
});

describe('loop guard', () => {
  it('trips after five identical non-edit tool calls in a row, once', () => {
    let trips = 0;
    const guard = createLoopGuard('Bolt', { streak: 5 }, () => (trips += 1));
    for (let index = 0; index < 7; index += 1) guard.observe(call('Read `a.ts`', 'read', 'a.ts:'));
    expect(trips).toBe(1);
    expect(guard.tripped()).toBe('Bolt repeated `Read `a.ts`` 5 times in a row');
  });

  it('resets on a different call or an edit, so an edit and test loop never trips', () => {
    let trips = 0;
    const guard = createLoopGuard('Bolt', { streak: 3 }, () => (trips += 1));
    for (let index = 0; index < 5; index += 1) {
      guard.observe(call('Run `pnpm test`', 'execute'));
      guard.observe(call('Edit `a.ts`', 'edit'));
    }
    guard.observe(call('Read `a.ts`'));
    guard.observe(call('Read `b.ts`'));
    expect(trips).toBe(0);
  });

  it('tells same-titled calls apart by their target', () => {
    let trips = 0;
    const guard = createLoopGuard('Bolt', { streak: 5 }, () => (trips += 1));
    for (let index = 0; index < 8; index += 1) {
      guard.observe(call('Read File', 'read', `src/file-${index}.ts:`));
    }
    expect(trips).toBe(0);
  });

  it('allows twice the streak for lookups with no target', () => {
    let trips = 0;
    const guard = createLoopGuard('Bolt', { streak: 5 }, () => (trips += 1));
    for (let index = 0; index < 9; index += 1) guard.observe(call('Read File'));
    expect(trips).toBe(0);
    guard.observe(call('Read File'));
    expect(trips).toBe(1);
    const commands = createLoopGuard('Bolt', { streak: 5 }, () => (trips += 1));
    for (let index = 0; index < 5; index += 1) commands.observe(call('Run tests', 'execute'));
    expect(trips).toBe(2);
  });

  it('does nothing when turned off', () => {
    const guard = createLoopGuard('Bolt', null, () => {
      throw new Error('should not trip');
    });
    for (let index = 0; index < 10; index += 1) guard.observe(call('Read `a.ts`'));
    expect(guard.tripped()).toBeNull();
  });
});
