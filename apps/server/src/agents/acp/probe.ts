import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import * as acp from '@agentclientprotocol/sdk/unstable';
import { ProviderError, type ProviderCapabilityReport } from '../../providers/provider.ts';
import type { SecretStore } from '../../setup/secrets.ts';
import type { AgentDefinition, AgentLaunch } from './agents.ts';
import { startAgentProcess, type AgentProcess } from './agent-process.ts';
import { agentEnvironment } from './agent-env.ts';
import { cliEnvironment, type CliLocator } from './agent-cli.ts';
import { prepareCodexLaunch } from './codex-launch.ts';
import type { ProviderAccount } from '@spark-outpost/contracts';
import { AUTH_STATUS_METHOD, parseAuthStatus } from './auth-status.ts';
import {
  capabilitiesFrom,
  offeredCapabilities,
  reportedAccess,
  sessionCapabilities,
} from './capabilities.ts';
import { findOption } from './session-config.ts';
import { CLIENT_CAPABILITIES, CLIENT_INFO } from './client-info.ts';
import { assertProtocolVersion, toProviderError } from './errors.ts';
import { deleteQuietly } from './session-open.ts';

export interface ProbeOptions {
  launch?: AgentLaunch;
  locateCli?: CliLocator;
  env?: Record<string, string>;
  secrets?: Pick<SecretStore, 'get'>;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 45_000;
const ACCOUNT_WAIT_MS = 400;

type WithAccess = (
  report: ProviderCapabilityReport,
  initial: readonly acp.SessionConfigOption[],
) => Promise<ProviderCapabilityReport>;

async function readReport(
  ctx: acp.ClientContext,
  session: acp.NewSessionResponse,
  withAccess: WithAccess,
): Promise<ProviderCapabilityReport> {
  const report = sessionCapabilities(session);
  const initial = session.configOptions ?? [];
  if (report.efforts.length > 0) return withAccess(report, initial);
  const modelOption = findOption(initial, 'model');
  if (!modelOption) return withAccess(report, initial);
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
  return withAccess({ ...report, efforts: [...efforts.values()] }, initial);
}

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
    let account: ProviderAccount | null = null;
    const client = acp
      .client(CLIENT_INFO)
      .onNotification(AUTH_STATUS_METHOD, parseAuthStatus, (notified) => {
        account = notified.params ?? account;
      });
    const withAccess: WithAccess = async (report, initial) => {
      if (definition.reportsModelAccess && account === null) await delay(ACCOUNT_WAIT_MS);
      const offered = offeredCapabilities(report, definition.offers);
      const access = reportedAccess(definition, initial);
      return { ...offered, access: { ...access, account: access.reported ? account : null } };
    };
    const read = client.connectWith(running.stream, async (ctx) => {
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
      try {
        return await readReport(ctx, session, withAccess);
      } finally {
        await deleteQuietly(ctx, init, session.sessionId);
      }
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
    await agent?.kill();
    await rm(workdir, { recursive: true, force: true });
  }
}
