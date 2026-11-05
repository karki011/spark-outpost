import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentDefinitions } from './agents.ts';

interface Resolved {
  effective: { permissions?: { deny?: string[] } };
  sources: { source: string }[];
}

type ResolveSettings = (options: {
  cwd: string;
  settingSources: string[];
  managedSettings: Record<string, unknown>;
}) => Promise<Resolved>;

async function sdkResolveSettings(): Promise<ResolveSettings> {
  const require = createRequire(import.meta.url);
  const adapter = require.resolve('@agentclientprotocol/claude-agent-acp/package.json');
  const entry = createRequire(adapter).resolve('@anthropic-ai/claude-agent-sdk');
  const sdk = (await import(pathToFileURL(entry).href)) as { resolveSettings: ResolveSettings };
  return sdk.resolveSettings;
}

describe("a company's managed Claude Code settings", () => {
  let cwd: string;

  beforeAll(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'spark-managed-'));
  });

  afterAll(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('still load as the policy tier when the session reads no settings files', async () => {
    const resolveSettings = await sdkResolveSettings();
    const resolved = await resolveSettings({
      cwd,
      settingSources: [],
      managedSettings: { permissions: { deny: ['WebSearch'] } },
    });
    const sources = resolved.sources.map((entry) => entry.source);
    expect(sources).toContain('managed');
    expect(sources.filter((source) => ['user', 'project', 'local'].includes(source))).toEqual([]);
    expect(resolved.effective.permissions?.deny).toContain('WebSearch');
  });

  it('are never replaced by Spark, which sends no policy tier of its own', () => {
    for (const meta of [
      agentDefinitions.claude.doSessionMeta?.([]),
      agentDefinitions.claude.projectSessionMeta?.([]),
      agentDefinitions.claude.conversationSessionMeta?.(),
    ]) {
      const options = (meta as { claudeCode: { options: Record<string, unknown> } }).claudeCode
        .options;
      expect(options.settingSources).toEqual([]);
      expect(options).not.toHaveProperty('managedSettings');
    }
  });
});
