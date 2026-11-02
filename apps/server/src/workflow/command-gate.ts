import {
  modeKind,
  modePosture,
  redactText,
  type AgentModeOption,
  type RunMode,
} from '@spark-outpost/contracts';
import {
  secretLabels,
  type ApprovalRequest,
  type DecideOptions,
  type Decision,
  type RequestRoot,
} from '../approvals/decide.ts';
import { diskFiles, type FileSource } from '../approvals/file-lister.ts';
import { withPrefetchedFiles } from '../approvals/prefetched-files.ts';
import type { PublishGrant } from '../approvals/publish-policy.ts';
import { secretReadLabels } from '../approvals/secret-reads.ts';
import { secretSend } from '../approvals/secret-send.ts';
import { parseShell } from '../approvals/shell-parse.ts';
import {
  SPARK_COMMAND_OPTIONS,
  commandHoldsSecret,
  decideSparkCommand,
  sparkCommandRefusal,
  sparkCommandRequest,
  type SparkCommandStart,
  type SparkCommandTurn,
} from '../approvals/spark-command.ts';
import type { SentOut } from '../approvals/taint.ts';
import type { RunObservations } from '../observations/run-observations.ts';
import type { NewApproval } from '../persistence/approvals.ts';
import type { Queryable } from '../persistence/db.ts';
import { forcePushDefault } from './approval-gate.ts';
import { approvalPayload, displayTitle, subject } from './approval-payload.ts';
import { publishContext } from './publish-context.ts';
import { ownRepoFor } from './send-context.ts';
import { ruleSettingReason } from '../approvals/gh-rules.ts';
import { sparkRulesForRun } from '../persistence/spark-rules.ts';

export interface SparkCommandScope {
  db: Queryable;
  runId: string;
  provider: string;
  agentMode: string | null;
  modes?: readonly AgentModeOption[];
  runMode: RunMode | null;
  readOnly: boolean;
  roots: readonly RequestRoot[];
  home: string;
  publish?: PublishGrant | undefined;
  observations?: RunObservations | undefined;
  files?: FileSource;
}

export interface SparkCommandAudit {
  command: string;
  cwd: string | null;
  mode: string | null;
  decision: 'mode' | 'card' | 'refused';
  reason: string | null;
  unreviewed: boolean;
}

export interface SparkCommandEffects {
  sent: SentOut | null;
  observed: readonly string[];
  sendsTo: string | null;
  secretReads: readonly string[];
}

interface Reviewed {
  request: ApprovalRequest;
  audit: SparkCommandAudit;
}

export type SparkCommandReview =
  | (Reviewed & { verdict: 'allow'; effects: SparkCommandEffects })
  | (Reviewed & { verdict: 'ask'; card: NewApproval; effects: SparkCommandEffects })
  | (Reviewed & { verdict: 'refuse'; reason: string });

type Asked = Extract<Decision, { verdict: 'ask' }>;

interface Weighed {
  decision: Decision;
  secretReads: string[];
}

const UNDECIDED: Weighed = { decision: { verdict: 'ask', reason: null }, secretReads: [] };

function turnOf(scope: SparkCommandScope): SparkCommandTurn {
  return {
    runMode: scope.runMode,
    posture: modePosture(
      scope.provider,
      scope.agentMode,
      modeKind(scope.modes ?? [], scope.agentMode),
    ),
    readOnly: scope.readOnly,
    roots: scope.roots,
    home: scope.home,
    agentMode: scope.agentMode,
  };
}

async function factsFor(
  scope: SparkCommandScope,
  request: ApprovalRequest,
): Promise<DecideOptions> {
  return {
    defaultBranch: await forcePushDefault(request),
    observed: (await scope.observations?.labels()) ?? [],
    own: await ownRepoFor(scope.db, scope.runId, request),
    secretSend: await secretSend(request),
    shell: await parseShell(request.command),
    sparkRules: await sparkRulesForRun(scope.db, scope.runId),
    ...(await publishContext(scope.db, scope.publish, request)),
  };
}

function cardFor(scope: SparkCommandScope, request: ApprovalRequest, asked: Asked): NewApproval {
  return {
    runId: scope.runId,
    toolCallId: request.toolCallId,
    rpcId: null,
    kind: 'execute',
    title: displayTitle(request),
    payload: approvalPayload(request, asked),
    options: [...SPARK_COMMAND_OPTIONS],
    reason: asked.reason,
  };
}

export const WITHHELD_COMMAND = '[withheld: it looks like it holds a secret]';

function auditCommand(command: string): string {
  return commandHoldsSecret(command) ? WITHHELD_COMMAND : redactText(command);
}

function auditOf(
  scope: SparkCommandScope,
  request: ApprovalRequest,
  decision: SparkCommandAudit['decision'],
  reason: string | null,
): SparkCommandAudit {
  return {
    command: auditCommand(request.command ?? ''),
    cwd: request.cwd,
    mode: scope.agentMode,
    decision,
    reason,
    unreviewed: decision === 'mode',
  };
}

function refused(
  scope: SparkCommandScope,
  request: ApprovalRequest,
  reason: string,
): SparkCommandReview {
  return { verdict: 'refuse', reason, request, audit: auditOf(scope, request, 'refused', reason) };
}

export async function reviewSparkCommand(
  scope: SparkCommandScope,
  start: SparkCommandStart,
): Promise<SparkCommandReview> {
  const turn = turnOf(scope);
  const request = sparkCommandRequest(turn, start);
  const early = sparkCommandRefusal(turn, request);
  if (early) return refused(scope, request, early);
  const facts = await factsFor(scope, request);
  const { decision, secretReads } = await withPrefetchedFiles(
    scope.files ?? diskFiles,
    (files): Weighed => ({
      decision: decideSparkCommand(turn, request, { ...facts, files }),
      secretReads: secretReadLabels(request, files, facts.shell ?? null),
    }),
    UNDECIDED,
  );
  if (decision.verdict === 'reject') {
    const reason = decision.sparkRule ? ruleSettingReason(decision.sparkRule) : decision.reason;
    return refused(scope, request, reason);
  }
  if (decision.verdict === 'allow') {
    const effects = { sent: decision.sent ?? null, observed: [], sendsTo: null, secretReads };
    return { verdict: 'allow', request, audit: auditOf(scope, request, 'mode', null), effects };
  }
  const named = decision.secretFiles ? secretLabels(request) : [];
  return {
    verdict: 'ask',
    request,
    card: cardFor(scope, request, decision),
    audit: auditOf(scope, request, 'card', decision.reason),
    effects: {
      sent: null,
      observed: decision.observed ?? [],
      sendsTo: decision.sendsTo ?? null,
      secretReads: [...new Set([...secretReads, ...named])],
    },
  };
}

type Passed = Extract<SparkCommandReview, { verdict: 'allow' | 'ask' }>;

export function sparkCommandAsked(
  scope: Pick<SparkCommandScope, 'observations'>,
  review: Extract<SparkCommandReview, { verdict: 'ask' }>,
  approvalId: string,
): void {
  if (review.effects.observed.length === 0) return;
  scope.observations?.egressAsked({
    approvalId,
    subject: subject(review.request),
    reason: review.card.reason,
    observed: review.effects.observed,
    sendsTo: review.effects.sendsTo ?? undefined,
  });
}

export function sparkCommandStarted(
  scope: Pick<SparkCommandScope, 'observations'>,
  review: Passed,
  approvalId: string | null,
): void {
  if (review.effects.sent) {
    scope.observations?.sentOut({
      toolCallId: review.request.toolCallId,
      subject: subject(review.request),
      ...(approvalId ? { approvalId } : {}),
      ...review.effects.sent,
    });
  }
  for (const label of review.effects.secretReads) {
    scope.observations?.record({ source: 'secret_file', label });
  }
}
