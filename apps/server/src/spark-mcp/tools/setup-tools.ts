import {
  AUTONOMY_LEVELS,
  autonomyLabel,
  reaskPercent,
  ticketSourceIdSchema,
  ticketSourceNames,
  type ProviderSetup,
} from '@spark-outpost/contracts';
import { conversationProjectIds } from '../../agent-config/store.ts';
import { effectiveFor } from '../../mcp/effective.ts';
import { enablementsFor, listUserMcp } from '../../mcp/store.ts';
import { getAttentionSettings } from '../../persistence/attention-settings.ts';
import { draftChatSettings } from '../../persistence/chat-settings.ts';
import { providerIssues } from '../../persistence/provider-health.ts';
import { getSetupState } from '../../persistence/setup.ts';
import { gitHubStatus } from '../../ship/github/access.ts';
import { ticketConnections } from '../../tickets/connections.ts';
import { gitHubDepsFor, ticketDepsFor } from '../deps.ts';
import { sparkTool, type SparkToolContext } from '../tool.ts';
import { reportedModel } from '../../providers/reported-model.ts';

function providerLine(provider: ProviderSetup, defaultProvider: string | null) {
  const connection = provider.connection;
  return {
    id: provider.id,
    name: provider.name,
    connected: connection !== null,
    default: provider.id === defaultProvider,
    ...(connection
      ? {
          method: connection.method === 'cli' ? 'local CLI login' : 'API key (stored in keychain)',
          account: connection.summary || connection.detail,
          ...reportedModel(provider.id, connection.model),
          effort: connection.effort,
          agentMode: connection.agentMode,
          lastTest: connection.lastTest,
          connectedAt: connection.verifiedAt,
        }
      : { connectWith: provider.methods }),
  };
}

async function providers({ deps, scope }: SparkToolContext) {
  const [setup, issues] = await Promise.all([
    getSetupState(deps.db, scope.workspaceId, deps.serverSpendCapUsd),
    providerIssues(deps.db, scope.workspaceId),
  ]);
  const defaultProvider = setup.profile.defaultProvider;
  return {
    defaultProvider,
    providers: setup.providers.map((provider) => providerLine(provider, defaultProvider)),
    advisors: setup.advisors.map((advisor) => ({
      id: advisor.id,
      name: advisor.name,
      role: advisor.role,
      connected: advisor.connection !== null,
      model: advisor.connection?.model ?? null,
    })),
    problemsLast24h: issues,
  };
}

async function mcpServers({ deps, scope }: SparkToolContext) {
  const servers = await listUserMcp(deps.db, scope.workspaceId);
  const rows = await enablementsFor(
    deps.db,
    servers.map((server) => server.id),
  );
  const chatId = scope.conversationId;
  const chatProjects = chatId ? await conversationProjectIds(deps.db, chatId) : [];
  return servers.map((server) => ({
    name: server.name,
    transport: server.transport,
    onForAllChats: effectiveFor(server, rows, null, []).enabled,
    onInProjects: rows.filter(
      (row) => row.serverId === server.id && row.scope === 'project' && row.enabled,
    ).length,
    ...(chatId ? { onInThisChat: effectiveFor(server, rows, chatId, chatProjects).enabled } : {}),
    lastCheck: server.check
      ? { ok: server.check.ok, tools: server.check.tools, at: server.check.checkedAt }
      : null,
  }));
}

async function connectors(context: SparkToolContext) {
  const { deps, scope } = context;
  const [tickets, github, mcp] = await Promise.all([
    ticketConnections(ticketDepsFor(deps, scope)),
    gitHubStatus(gitHubDepsFor(deps, scope)),
    mcpServers(context),
  ]);
  const ticketSources = ticketSourceIdSchema.options.map((source) => {
    const connection = tickets.connections.find((entry) => entry.source === source);
    return {
      source: ticketSourceNames[source],
      connected: connection !== undefined && connection.keySaved,
      ...(connection
        ? {
            account: connection.account,
            site: connection.siteUrl,
            checkedAt: connection.validatedAt,
            moveOnShip: connection.moveOnShip,
            moveOnMerge: connection.moveOnMerge,
            ...(connection.keySaved ? {} : { problem: 'The saved key is missing; reconnect it.' }),
          }
        : {}),
    };
  });
  return {
    github: {
      connected: github.active !== null,
      via: github.active === 'gh_cli' ? 'gh CLI' : github.active === 'token' ? 'saved PAT' : null,
      ghCli: github.ghCli,
      patAccount: github.token
        ? {
            host: github.token.host,
            login: github.token.login,
            scopes: github.token.scopes,
            expiresAt: github.token.expiresAt,
            checkedAt: github.token.validatedAt,
            repos: github.token.repos,
          }
        : null,
    },
    tickets: ticketSources,
    mcpServers: mcp,
    note: 'Spark connects GitHub, Jira and Linear itself; other services (for example Slack) only as MCP servers.',
  };
}

async function settings({ deps, scope }: SparkToolContext) {
  const [setup, attention, chatDefaults] = await Promise.all([
    getSetupState(deps.db, scope.workspaceId, deps.serverSpendCapUsd),
    getAttentionSettings(deps.db, scope.workspaceId),
    draftChatSettings(deps.db, scope.workspaceId),
  ]);
  const { profile } = setup;
  return {
    displayName: profile.displayName,
    defaultProvider: profile.defaultProvider,
    defaultAutonomy: autonomyLabel(profile.defaultLevel),
    autonomyLevels: AUTONOMY_LEVELS.map((level) => ({ name: level.label, means: level.hint })),
    personality: profile.personality,
    sparkEnabled: profile.sparkEnabled,
    spendCapPerTaskUsd: profile.spendCapUsd,
    serverSpendCapUsd: deps.serverSpendCapUsd,
    morningBrief: { on: profile.morningBrief, time: profile.morningBriefTime },
    autoContinueSeconds: profile.autoContinueSeconds,
    contextCompaction: {
      warnAtPercent: profile.compactWarnPercent,
      compactAtPercent: profile.compactAtPercent,
      compactAutomatically: profile.autoCompact,
      askAgainAfterKeepGoingAtPercent: reaskPercent(profile.compactAtPercent),
    },
    jevReviewsDiffs: profile.jevDiffs,
    shipWithFailingChecks: profile.shipFailingChecks,
    openPullRequestsAs: profile.prReadyForReview ? 'ready for review' : 'draft',
    prFollowUp: {
      on: profile.prFollowUp,
      fixFailingChecks: profile.prFollowUpChecks,
      handleReviewComments: profile.prFollowUpReviews,
      replyOnGitHub: profile.prFollowUpReplies,
    },
    anonymousHeartbeat: profile.heartbeat,
    newChatDefaults: {
      provider: chatDefaults.provider,
      ...reportedModel(chatDefaults.provider, chatDefaults.model),
      effort: chatDefaults.effort,
      agentMode: chatDefaults.agentMode,
      autonomy: chatDefaults.level ? autonomyLabel(chatDefaults.level) : null,
    },
    ticketAttention: attention,
  };
}

export const setupTools = [
  sparkTool({
    name: 'spark_providers',
    title: 'AI providers',
    description:
      'Which AI agents (Claude, Codex, Z.ai) and advisors (Jev) are connected to Spark, how (CLI login or API key; keys are never shown), their default model, effort and mode, which one is the default, and provider problems from the last 24 hours.',
    input: {},
    run: (_args, context) => providers(context),
  }),
  sparkTool({
    name: 'spark_connectors',
    title: 'Connectors',
    description:
      "Whether GitHub, Jira and Linear are connected (account, site, last check) and the user's MCP servers (on or off, last connection test). Never returns tokens.",
    input: {},
    run: (_args, context) => connectors(context),
  }),
  sparkTool({
    name: 'spark_settings',
    title: 'Spark settings',
    description:
      'Non-secret Settings → Spark values: whether Spark is on, default autonomy level (Review each step, Automatic, Full auto → PR) and what each means, personality, spend cap per task, auto-continue wait, context compaction thresholds (warn, compact, automatic on or off), what Full auto does when checks fail, morning brief time, whether the desktop app sends its anonymous daily heartbeat (Settings → Help), new-chat defaults and ticket attention rules. Per-project Builders at once and Where Spark works are in spark_projects.',
    input: {},
    run: (_args, context) => settings(context),
  }),
];
