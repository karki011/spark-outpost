import { describe, expect, it, vi } from 'vitest';
import { ownerAuth } from './owner-auth.ts';

function fakeAddon(change: Record<string, unknown> = {}) {
  return {
    ownerAuthAvailable: () => true,
    authenticateOwner: (_reason: string, done: (outcome: unknown) => void) => {
      queueMicrotask(() => done('ok'));
      return 'started';
    },
    ...change,
  };
}

const answering = (outcome: unknown) =>
  fakeAddon({
    authenticateOwner: (_reason: string, done: (outcome: unknown) => void) => {
      done(outcome);
      return 'started';
    },
  });

describe('macOS owner authentication', () => {
  it('asks macOS with the reason and passes its answer on', async () => {
    const asked: string[] = [];
    const addon = fakeAddon({
      authenticateOwner: (reason: string, done: (outcome: unknown) => void) => {
        asked.push(reason);
        done('ok');
        return 'started';
      },
    });
    const auth = ownerAuth('/addon.node', vi.fn(), () => addon);
    expect(auth.available()).toBe(true);
    expect(await auth.authenticate('reset the code')).toBe('ok');
    expect(asked).toEqual(['reset the code']);
  });

  it('reports a cancel, and treats an answer it does not know as a failure', async () => {
    const load = (outcome: unknown) => ownerAuth('/a', vi.fn(), () => answering(outcome));
    expect(await load('cancelled').authenticate('r')).toBe('cancelled');
    expect(await load('unavailable').authenticate('r')).toBe('unavailable');
    expect(await load('granted').authenticate('r')).toBe('failed');
    expect(await load(true).authenticate('r')).toBe('failed');
  });

  it('fails when the prompt could not start or the addon throws', async () => {
    const refused = ownerAuth('/a', vi.fn(), () =>
      fakeAddon({ authenticateOwner: () => 'failed' }),
    );
    expect(await refused.authenticate('r')).toBe('failed');
    const broken = ownerAuth('/a', vi.fn(), () =>
      fakeAddon({
        ownerAuthAvailable: () => {
          throw new Error('boom');
        },
        authenticateOwner: () => {
          throw new Error('boom');
        },
      }),
    );
    expect(broken.available()).toBe(false);
    expect(await broken.authenticate('r')).toBe('failed');
  });

  it('is unavailable, and says how to build it, when the addon is missing or too old', async () => {
    const log = vi.fn();
    const missing = ownerAuth('/gone.node', log, () => {
      throw new Error('not found');
    });
    const old = ownerAuth('/old.node', log, () => ({ preventActivation: () => 'applied' }));
    for (const auth of [missing, old]) {
      expect(auth.available()).toBe(false);
      expect(await auth.authenticate('r')).toBe('unavailable');
    }
    expect(log.mock.calls[0]![0]).toContain('pnpm desktop:no-activate');
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('is unavailable when macOS has no way to authenticate the owner', () => {
    const auth = ownerAuth('/a', vi.fn(), () => fakeAddon({ ownerAuthAvailable: () => false }));
    expect(auth.available()).toBe(false);
  });
});
