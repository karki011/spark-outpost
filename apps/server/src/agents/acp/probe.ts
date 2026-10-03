import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import * as acp from '@agentclientprotocol/sdk';
import { ProviderError, type ProviderCapabilityReport } from '../../providers/provider.ts';
import type { SecretStore } from '../../setup/secrets.ts';
import type { AgentDefinition, AgentLaunch } from './agents.ts';
import { startAgentProcess, type AgentProcess } from './agent-process.ts';
import { agentEnvironment } from './agent-env.ts';
import { cliEnvironment, type CliLocator } from './agent-cli.ts';
import { prepareCodexLaunch } from './codex-launch.ts';
import { capabilitiesFrom, offeredCapabilities, sessionCapabilities } from './capabilities.ts';
import { findOption } from './session-config.ts';
import { CLIENT_CAPABILITIES, CLIENT_INFO } from './client-info.ts';
import { assertProtocolVersion, toProviderError } from './errors.ts';

export interface ProbeOptions {
  launch?: AgentLaunch;
  locateCli?: CliLocator;
  env?: Record<string, string>;
  secrets?: Pick<SecretStore, 'get'>;
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
    const located = options.launch ? {} : await cliEnvironment(definition, options.locateCli);
    const { cli, profiles } = located.CODEX_PATH
      ? await prepareCodexLaunch(located, workdir, false)
      : { cli: located, profiles: true };
    const env = {
      ...(await agentEnvironment({ ...options, definition, codexProfiles: profiles }, workdir)),
      ...cli,
    };
    agent = startAgentProcess(options.launch ?? definition.launch(), workdir, env);
    const running = agent;
    const read = acp.client(CLIENT_INFO).connectWith(running.stream, async (ctx) => {
      const init = await ctx.request<acp.InitializeResponse, acp.InitializeRequest>(
        acp.methods.agent.initialize,
        {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: CLIENT_CAPABILITIES,
          clientInfo: CLIENT_INFO,
        },
      );
      assertProtocolVersion(definition.name, init);
      const session = await ctx.request(acp.methods.agent.session.new, {
        cwd: workdir,
        mcpServers: [],
        _meta: definition.probeSessionMeta ?? definition.conversationSessionMeta?.() ?? null,
      });
      const report = sessionCapabilities(session);
      if (report.efforts.length > 0) return offeredCapabilities(report, definition.offers);
      const modelOption = findOption(session.configOptions ?? [], 'model');
      if (!modelOption) return offeredCapabilities(report, definition.offers);
      const efforts = new Map(report.efforts.map((effort) => [effort.id, effort]));
      for (const model of report.models) {
        if (model.id === report.defaultModel) continue;
        const response = await ctx.request(acp.methods.agent.session.setConfigOption, {
          sessionId: session.sessionId,
          configId: modelOption.id,
          value: model.id,
        });
        for (const effort of capabilitiesFrom(response.configOptions).efforts) {
          if (!efforts.has(effort.id)) efforts.set(effort.id, effort);
        }
      }
      return offeredCapabilities({ ...report, efforts: [...efforts.values()] }, definition.offers);
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
