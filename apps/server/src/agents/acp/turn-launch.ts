import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  claudeConfigDir,
  loadPermissionRules,
  NO_PERMISSION_RULES,
  type PermissionRules,
} from '../../agent-config/permission-rules.ts';
import { ProviderError, type ProviderTurn } from '../../providers/provider.ts';
import { sparkFloor, type SparkFloor } from '../../spark-rules/floor-flags.ts';
import { floorRulesNow } from '../../spark-rules/rules-store.ts';
import { resolveUserMcp } from '../../mcp/launch.ts';
import { primaryRoot, type PathPolicy } from '../../projects/path-policy.ts';
import { childEnvironment } from '../../setup/environment.ts';
import { agentEnvironment } from './agent-env.ts';
import { cliEnvironment } from './agent-cli.ts';
import { supportsDo, type AgentDefinition } from './agents.ts';
import { CODEX_PLAIN_SANDBOX_NOTE, prepareCodexLaunch } from './codex-launch.ts';
import { codexUserMcpNames } from './codex-mcp.ts';
import { connectionKey, type ConnectionKey } from './connection-key.ts';
import { noFolderAccessNote, primaryOnlyNote } from './folder-notes.ts';
import { startLiveConnection, type LiveConnection } from './live-connection.ts';
import {
  namedMcpServers,
  prepareRepoSession,
  type NamedMcpServer,
  type RepoSession,
} from './repo-session.ts';
import { openProject } from './session-start.ts';
import { replayFilter, type ReplayFilter } from './session-open.ts';
import {
  auditCodexInstructions,
  withCodexSpark,
  type SparkToolsHint,
} from './spark-instructions.ts';
import {
  sparkReserved,
  sparkToolsHint,
  withCodexSparkServer,
  type SparkTools,
} from './spark-tools.ts';
import type { AcpProviderOptions } from './acp-provider.ts';

export interface Workspace {
  cwd: string;
  home: string;
  policy: PathPolicy | null;
  notes: string[];
  changing: boolean;
  replay: ReplayFilter;
  repo: RepoSession | null;
  mcpServers: NamedMcpServer[];
  spark: SparkToolsHint | null;
  rules: PermissionRules;
  floor: SparkFloor;
}

export interface LaunchPlan {
  workspace: Workspace;
  key: ConnectionKey;
  browsing: boolean;
  cannotPush: boolean;
  scratch: string | null;
}

export async function discardScratch(plan: LaunchPlan): Promise<void> {
  if (plan.scratch) await rm(plan.scratch, { recursive: true, force: true });
}

function openedRoots(
  definition: AgentDefinition,
  turn: ProviderTurn,
  linked: readonly string[],
): readonly string[] {
  return turn.mode === 'do' && definition.doPrimaryRootOnly ? linked.slice(0, 1) : linked;
}

function assertCanChange(definition: AgentDefinition, turn: ProviderTurn): void {
  if (!supportsDo(definition)) {
    throw new ProviderError(`${definition.name} can't make changes in Do mode yet.`);
  }
  if (!turn.approvals) {
    throw new ProviderError('Do mode needs the approval gate, so the run was stopped.');
  }
}

async function turnFloor(): Promise<SparkFloor> {
  return sparkFloor(await floorRulesNow());
}

export async function planLaunch(
  options: AcpProviderOptions,
  turn: ProviderTurn,
  legacyPermissions: boolean,
): Promise<LaunchPlan> {
  const { definition } = options;
  const linked = turn.projectRoots ?? [];
  const roots = openedRoots(definition, turn, linked);
  const browsing = roots.length > 0 && definition.readsProjectFolders;
  const policy = browsing ? await openProject(definition, roots) : null;
  const workdir = turn.session?.workdir ?? null;
  if (workdir) await mkdir(workdir, { recursive: true });
  const scratch = workdir ? null : await mkdtemp(join(tmpdir(), 'spark-outpost-run-'));
  const home = workdir ?? scratch ?? tmpdir();
  const cwd = policy ? primaryRoot(policy) : home;
  const userMcp = await resolveUserMcp(turn.userMcp ?? [], options.secrets);
  const own =
    definition.repoStyle === 'codex'
      ? await codexUserMcpNames(options.env ?? childEnvironment(process.env))
      : [];
  const spark = sparkToolsHint(options.sparkTools, turn.sparkScope, own);
  const reserved = sparkReserved(own);
  const repo =
    policy && turn.repo
      ? await prepareRepoSession(
          turn.repo.filter((entry) => roots.includes(entry.root)),
          definition.repoStyle,
          userMcp,
          reserved,
        )
      : null;
  const mcpServers = repo?.mcpServers ?? namedMcpServers([], userMcp, reserved);
  const rules =
    definition.repoStyle === 'claude'
      ? await loadPermissionRules(
          policy?.roots.map((root) => root.path) ?? [],
          claudeConfigDir(options.env ?? process.env),
        )
      : NO_PERMISSION_RULES;
  const floor = await turnFloor();
  const notes = roots.length > 0 && !browsing ? [noFolderAccessNote(definition)] : [];
  if (roots.length < linked.length) notes.push(primaryOnlyNote(definition, roots[0]!));
  const changing = policy !== null && turn.mode === 'do';
  if (changing) assertCanChange(definition, turn);
  const cannotPush = turn.changesProject === true && turn.publishes !== true;
  const key = connectionKey({
    agent: definition.id,
    launch: options.launch ?? definition.launch(),
    method: turn.settings.method,
    cwd,
    roots: policy?.roots.map((root) => root.path) ?? [],
    files: [policy !== null, changing, turn.approvals !== undefined],
    browsing,
    cannotPush,
    legacyPermissions,
    mcp: mcpServers,
    repo: repo ? { claude: repo.claude, codex: repo.codex } : null,
    instructions: turn.spark ?? null,
    sparkTools: spark,
    session: [turn.changesProject === true, turn.planning === true],
    codexServers: own,
    rules,
    floor,
  });
  return {
    workspace: {
      cwd,
      home,
      policy,
      notes,
      changing,
      replay: replayFilter(turn.audit),
      repo,
      mcpServers,
      spark,
      rules,
      floor,
    },
    key,
    browsing,
    cannotPush,
    scratch,
  };
}

export interface Spawned {
  connection: LiveConnection;
  notes: string[];
}

export async function spawnConnection(
  options: AcpProviderOptions,
  turn: ProviderTurn,
  plan: LaunchPlan,
  tools: SparkTools | null,
  legacyPermissions: boolean,
): Promise<Spawned> {
  const { definition } = options;
  const { workspace } = plan;
  const codex = withCodexSpark(workspace.repo?.codex ?? null, turn.spark, workspace.spark);
  if (definition.repoStyle === 'codex') auditCodexInstructions(turn.audit, codex);
  const located = options.launch ? {} : await cliEnvironment(definition, options.locateCli);
  const launchDir =
    definition.repoStyle === 'codex' ? await mkdtemp(join(tmpdir(), 'spark-codex-')) : null;
  const cleanup = async () => {
    if (plan.scratch) await rm(plan.scratch, { recursive: true, force: true });
    if (launchDir) await rm(launchDir, { recursive: true, force: true });
  };
  try {
    const prepared =
      launchDir && located.CODEX_PATH
        ? await prepareCodexLaunch(located, launchDir, legacyPermissions)
        : { cli: located, profiles: !legacyPermissions };
    const launchEnv = await agentEnvironment(
      { ...options, codexProfiles: prepared.profiles, floor: workspace.floor },
      workspace.home,
      plan.browsing,
      codex,
      plan.cannotPush,
    );
    const notes =
      definition.repoStyle === 'codex' && !prepared.profiles ? [CODEX_PLAIN_SANDBOX_NOTE] : [];
    const env = withCodexSparkServer(
      { ...launchEnv, ...prepared.cli },
      definition.repoStyle === 'codex' ? tools : null,
    );
    const connection = await startLiveConnection({
      launch: options.launch ?? definition.launch(),
      cwd: workspace.cwd,
      home: workspace.home,
      env,
      readsFiles: workspace.policy !== null,
      tracksBackground: definition.cli === 'claude',
      key: plan.key,
      cleanup,
    });
    return { connection, notes };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
