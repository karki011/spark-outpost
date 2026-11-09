import type * as acp from '@agentclientprotocol/sdk/unstable';
import { describe, expect, it } from 'vitest';
import { newSessionRequest, supportsAdditionalDirectories } from './session-request.ts';

const withCapability: acp.InitializeResponse = {
  protocolVersion: 1,
  agentCapabilities: { sessionCapabilities: { additionalDirectories: {} } },
};
const withoutCapability: acp.InitializeResponse = {
  protocolVersion: 1,
  agentCapabilities: { sessionCapabilities: {} },
};
const meta = { claudeCode: { options: { tools: ['Read'] } } };

describe('newSessionRequest', () => {
  it('reads the additionalDirectories capability', () => {
    expect(supportsAdditionalDirectories(withCapability)).toBe(true);
    expect(supportsAdditionalDirectories(withoutCapability)).toBe(false);
    expect(supportsAdditionalDirectories({ protocolVersion: 1 })).toBe(false);
  });

  it('sends extra roots as additionalDirectories when the agent advertises them', () => {
    const plan = newSessionRequest({
      agentName: 'Claude',
      cwd: '/work/app',
      extraRoots: ['/work/lib', '/work/docs'],
      meta,
      init: withCapability,
    });
    expect(plan.request).toEqual({
      cwd: '/work/app',
      mcpServers: [],
      _meta: meta,
      additionalDirectories: ['/work/lib', '/work/docs'],
    });
    expect(plan.notes).toEqual([]);
  });

  it('keeps only the primary root and explains why when the capability is missing', () => {
    const plan = newSessionRequest({
      agentName: 'Claude',
      cwd: '/work/spark-outpost',
      extraRoots: ['/work/lib'],
      meta: null,
      init: withoutCapability,
    });
    expect(plan.request).toEqual({ cwd: '/work/spark-outpost', mcpServers: [], _meta: null });
    expect(plan.notes).toEqual(['Claude can only open one repo per chat; using spark-outpost']);
  });

  it('omits additionalDirectories for a single repo even when supported', () => {
    const plan = newSessionRequest({
      agentName: 'Codex',
      cwd: '/work/app',
      extraRoots: [],
      meta: null,
      init: withCapability,
    });
    expect(plan.request).not.toHaveProperty('additionalDirectories');
    expect(plan.notes).toEqual([]);
  });
});
