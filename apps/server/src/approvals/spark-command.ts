import {
  isReadOnlyPosture,
  type AgentRole,
  type ApprovalOption,
  type ModePosture,
  type RunMode,
} from '@spark-outpost/contracts';
import { actionPath } from '../spark-mcp/actions/action-policy.ts';
import { hasSecretFlagPair, holdsSecret } from '../spark-mcp/actions/mcp-config.ts';
import { commandTree, treeWords } from './command-tree.ts';
import {
  DENIES_REASON,
  NO_RUN_RULES,
  decide,
  type ApprovalRequest,
  type DecideOptions,
  type Decision,
  type RequestRoot,
} from './decide.ts';
import type { PieceGuard } from './piece-guard.ts';
import { place } from './request-place.ts';

export const SPARK_COMMAND_TOOL_KIND = 'execute';
export const SPARK_COMMAND_NOTE =
  "Runs in a Spark terminal, outside the agent's sandbox, and keeps running after the turn.";
export const SPARK_COMMAND_OPTIONS: readonly ApprovalOption[] = [
  { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
  { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
];

export const NO_FOLDER_REASON = 'A Spark terminal needs a chat with a project folder';
export const READ_ONLY_TURN_REASON =
  "A Spark terminal can't start in an Ask or read-only turn; switch the agent's mode first";
export const CREW_REASON =
  'Only a solo Builder and the integrator can start a Spark terminal; pieces and the Coordinator cannot';
export const OUTSIDE_FOLDER_REASON =
  "A Spark terminal starts in the chat's folder or a folder under a linked project";
export const SECRET_COMMAND_REASON =
  'The command looks like it holds a secret. Name a variable or a file the shell already has instead of the value';

export interface SparkCommandTurn {
  runMode: RunMode | null;
  posture: ModePosture;
  role: AgentRole | null;
  piece: PieceGuard | null;
  readOnly: boolean;
  roots: readonly RequestRoot[];
  home: string;
  agentMode: string | null;
}

export interface SparkCommandStart {
  toolCallId: string;
  command: string;
  cwd: string | null;
}

export function sparkCommandRequest(
  turn: Pick<SparkCommandTurn, 'roots' | 'home' | 'agentMode'>,
  start: SparkCommandStart,
): ApprovalRequest {
  return {
    toolCallId: start.toolCallId,
    rpcId: null,
    kind: 'execute',
    toolKind: SPARK_COMMAND_TOOL_KIND,
    title: start.command,
    command: start.command,
    cwd: start.cwd ?? turn.roots[0]?.path ?? null,
    paths: [],
    diffs: [],
    options: [...SPARK_COMMAND_OPTIONS],
    roots: turn.roots,
    home: turn.home,
    ...(turn.agentMode === null ? {} : { mode: turn.agentMode }),
  };
}

export function commandHoldsSecret(command: string): boolean {
  if (holdsSecret(command)) return true;
  const words = treeWords(commandTree(command));
  return words.some(holdsSecret) || hasSecretFlagPair(words);
}

export function runsAtOnce(posture: ModePosture): boolean {
  return actionPath({ posture, requested: false }) === 'perform';
}

function insideRoots(roots: readonly RequestRoot[], folder: string): boolean {
  return roots.some((root) => root.path === folder) || place(roots, folder).relative !== null;
}

function crewRefusal(turn: Pick<SparkCommandTurn, 'role' | 'piece'>): string | null {
  if (turn.role === 'integrator') return null;
  if (turn.piece?.coordinated || turn.piece?.owned) return CREW_REASON;
  return turn.role === null || turn.role === 'builder' ? null : CREW_REASON;
}

export function sparkCommandRefusal(
  turn: SparkCommandTurn,
  request: ApprovalRequest,
): string | null {
  if (turn.roots.length === 0) return NO_FOLDER_REASON;
  if (turn.runMode !== 'do' || turn.readOnly || isReadOnlyPosture(turn.posture)) {
    return READ_ONLY_TURN_REASON;
  }
  const crew = crewRefusal(turn);
  if (crew) return crew;
  if (!request.cwd || !insideRoots(request.roots, request.cwd)) return OUTSIDE_FOLDER_REASON;
  return request.command && commandHoldsSecret(request.command) ? SECRET_COMMAND_REASON : null;
}

function carded(decision: Extract<Decision, { verdict: 'allow' }>): Decision {
  const sent = decision.sent
    ? { observed: decision.sent.observed, sendsTo: decision.sent.target }
    : {};
  return { verdict: 'ask', reason: null, because: SPARK_COMMAND_NOTE, ...sent };
}

export function decideSparkCommand(
  turn: SparkCommandTurn,
  request: ApprovalRequest,
  options: DecideOptions = {},
): Decision {
  const refused = sparkCommandRefusal(turn, request);
  if (refused) return { verdict: 'reject', reason: refused };
  const decision = decide(turn.posture, request, NO_RUN_RULES, [], {
    ...options,
    builder: turn.role === 'builder' || turn.role === 'integrator',
    askRun: false,
    askAutoWhy: null,
    agentAsks: false,
    ...(turn.piece ? { piece: turn.piece } : {}),
  });
  if (decision.verdict === 'reject') return decision;
  if (decision.verdict === 'ask') return { ...decision, because: SPARK_COMMAND_NOTE };
  if (runsAtOnce(turn.posture)) return decision;
  return turn.posture === 'denies'
    ? { verdict: 'reject', reason: DENIES_REASON }
    : carded(decision);
}
