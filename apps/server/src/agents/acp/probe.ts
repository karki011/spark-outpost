import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import * as acp from '@agentclientprotocol/sdk';
import { ProviderError, type ProviderCapabilityReport } from '../../providers/provider.ts';
import { childEnvironment } from '../../setup/environment.ts';
import type { AgentDefinition, AgentLaunch } from './agents.ts';
import { startAgentProcess, type AgentProcess } from './agent-process.ts';
import { sessionCapabilities } from './capabilities.ts';
import { CLIENT_CAPABILITIES, CLIENT_INFO } from './client-info.ts';
import { toProviderError } from './errors.ts';

export interface ProbeOptions {
  launch?: AgentLaunch;
  env?: Record<string, string>;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 45_000;

export async function probeCapabilities(
  definition: AgentDefinition,
  options: ProbeOptions = {},
): Promise<ProviderCapabilityReport> {
  const workdir = await mkdtemp(join(tmpdir(), 'spark-outpost-probe-'));
  let agent: AgentProcess | null = null;
  const timer = new AbortController();
  try {
    agent = startAgentProcess(options.launch ?? definition.launch(), workdir, {
      ...(options.env ?? childEnvironment(process.env)),
      ...definition.conversationEnv?.(workdir),
    });
    const running = agent;
    const read = acp.client(CLIENT_INFO).connectWith(running.stream, async (ctx) => {
      await ctx.request<acp.InitializeResponse, acp.InitializeRequest>(
        acp.methods.agent.initialize,
        {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: CLIENT_CAPABILITIES,
          clientInfo: CLIENT_INFO,
        },
      );
      const session = await ctx.request(acp.methods.agent.session.new, {
        cwd: workdir,
        mcpServers: [],
        _meta: definition.conversationSessionMeta ?? null,
      });
      return sessionCapabilities(session);
    });
    const timeout = delay(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, undefined, {
      signal: timer.signal,
    }).then(() => {
      throw new ProviderError(`${definition.name} took too long to report its models.`);
    });
    timeout.catch(() => undefined);
    return await Promise.race([read, running.exited, timeout]);
  } catch (error) {
    throw toProviderError(definition.name, error, agent?.stderrTail() ?? '');
  } finally {
    timer.abort();
    agent?.kill();
    await rm(workdir, { recursive: true, force: true });
  }
}
