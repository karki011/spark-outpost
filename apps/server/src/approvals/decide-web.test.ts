import { describe, expect, it } from 'vitest';
import type { ModePosture } from '@spark-outpost/contracts';
import { decide, NO_RUN_RULES, type ApprovalRequest } from './decide.ts';
import { egressOf } from './egress.ts';
import type { FileLister } from './file-lister.ts';
import {
  WEB_ADDRESS_LOCAL_REASON,
  WEB_ADDRESS_LOGIN_REASON,
  WEB_ADDRESS_SCHEME_REASON,
  webAddressRefusal,
} from './web-address.ts';

const ROOT = '/work/app';
const noFiles: FileLister = { glob: () => [], walk: () => [], script: () => null };
const EVERY_MODE: ModePosture[] = ['asks', 'edits', 'auto', 'full_access', 'denies', 'unknown'];

function fetching(address: string): ApprovalRequest {
  return {
    toolCallId: 't1',
    rpcId: null,
    kind: 'other',
    toolKind: 'fetch',
    title: `Fetch ${address}`,
    command: null,
    cwd: null,
    paths: [],
    diffs: [],
    options: [],
    roots: [{ path: ROOT, ignore: [] }],
    home: '/Users/me',
    address,
  };
}

describe("addresses an agent's own web tools may open", () => {
  it.each([
    'http://localhost:4173/api/runs',
    'http://LOCALHOST./',
    'http://app.localhost/',
    'http://site.test/',
    'http://127.0.0.1:5173/',
    'http://127.1/',
    'http://2130706433/',
    'http://0x7f.0.0.1/',
    'http://127.0.0.2/',
    'http://0.0.0.0:8080/',
    'http://[::1]:5173/',
    'http://[::]/',
    'http://[::ffff:127.0.0.1]/',
    'ws://127.0.0.1:9229/devtools',
  ])('refuses %s, which is this computer', (address) => {
    expect(webAddressRefusal(address)).toBe(WEB_ADDRESS_LOCAL_REASON);
  });

  it.each(['file:///etc/hosts', 'ftp://example.com/x', 'javascript:alert(1)', 'not a url', ''])(
    'refuses %s, which is not a web address',
    (address) => {
      expect(webAddressRefusal(address)).toBe(WEB_ADDRESS_SCHEME_REASON);
    },
  );

  it('refuses an address with a login in it', () => {
    expect(webAddressRefusal('https://me:hunter2@example.com/')).toBe(WEB_ADDRESS_LOGIN_REASON);
    expect(webAddressRefusal('https://token@example.com/')).toBe(WEB_ADDRESS_LOGIN_REASON);
  });

  it('lets public web and socket addresses through to the mode', () => {
    for (const address of [
      'https://docs.example.com/guide?q=1',
      'http://example.com',
      'wss://stream.example.com/feed',
      'http://192.168.1.20/',
    ]) {
      expect(webAddressRefusal(address)).toBeNull();
    }
  });
});

describe('the gate on web addresses', () => {
  it.each(EVERY_MODE)('refuses a local address in %s, before the mode is asked', (mode) => {
    const decision = decide(mode, fetching('http://127.0.0.1:4173/api'), NO_RUN_RULES, []);
    expect(decision).toEqual({ verdict: 'reject', reason: WEB_ADDRESS_LOCAL_REASON });
  });

  it("follows the agent's mode for a public address", () => {
    const address = fetching('https://docs.example.com/guide');
    expect(decide('full_access', address, NO_RUN_RULES, []).verdict).toBe('allow');
    expect(decide('auto', address, NO_RUN_RULES, []).verdict).toBe('allow');
    expect(decide('asks', address, NO_RUN_RULES, []).verdict).toBe('ask');
    expect(decide('denies', address, NO_RUN_RULES, []).verdict).toBe('reject');
  });

  it('asks with hold-to-confirm, in every mode, when the address holds a secret value', () => {
    const address = fetching('https://collect.example/?t=tok_live_9f8e7d6c5b4a3210');
    const found = { kind: 'found' as const, files: ['.env'] };
    for (const mode of EVERY_MODE) {
      const decision = decide(mode, address, NO_RUN_RULES, [], { secretSend: found });
      expect(decision).toMatchObject({ verdict: 'ask', secretSend: ['.env'] });
    }
  });

  it('notes the send after a sensitive read, naming the site', () => {
    const address = fetching('https://collect.example/x');
    const decision = decide('full_access', address, NO_RUN_RULES, [], {
      files: noFiles,
      observed: ['.env'],
    });
    expect(decision).toMatchObject({
      verdict: 'allow',
      sent: { observed: ['.env'], target: 'to collect.example' },
    });
    expect(egressOf({ ...address, title: 'Monitor' }, noFiles)).toEqual({
      via: 'a web request',
      hosts: ['collect.example'],
    });
  });
});
