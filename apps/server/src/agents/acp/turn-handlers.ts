import * as acp from '@agentclientprotocol/sdk/unstable';
import type { PathPolicy } from '../../projects/path-policy.ts';
import type {
  ProtocolObserver,
  ProviderOutput,
  ProviderTurn,
  QuestionGate,
} from '../../providers/provider.ts';
import type { AgentDefinition } from './agents.ts';
import { elicitationIdOf, askToOpen } from './open-address.ts';
import { askQuestion, type QuestionContext } from './questions.ts';
import {
  reviewPermission,
  readingTurnReviews,
  writeWithApproval,
  type DoWorkspace,
} from './do-handlers.ts';
import { readTextFile, refuseWrite } from './fs-handlers.ts';
import type { TurnHandlers } from './live-binding.ts';
import { declineInConversation, nativePlan } from './permissions.ts';
import type { AgentCli } from './agent-cli.ts';
import { floorRulesNow } from '../../spark-rules/rules-store.ts';
import { createRailWatch, type RailWatch } from './rail-watch.ts';
import type { RequestLog } from './turn-loop.ts';
import type { TurnMapper } from './subagent-updates.ts';

export interface TurnGates {
  gated: DoWorkspace | null;
  doing: DoWorkspace | null;
  rails: RailWatch | null;
  questions: QuestionGate | null;
}

export function turnGates(
  policy: PathPolicy | null,
  cwd: string,
  changing: boolean,
  turn: ProviderTurn,
  signal: AbortSignal,
  mapper: TurnMapper,
  push: (outputs: ProviderOutput[]) => void,
  cli: AgentCli,
): TurnGates {
  const gated: DoWorkspace | null =
    policy && turn.approvals
      ? {
          policy,
          cwd,
          gate: turn.approvals,
          signal,
          report: (name) => push(mapper.clientAction(name)),
          annotate: (name, subagent) => push(mapper.note(name, subagent)),
          asker: mapper.asker,
          mode: () => mapper.currentMode(),
          shownPlan: () => mapper.shownPlan(),
        }
      : null;
  const doing = changing ? gated : null;
  const rails = gated
    ? createRailWatch({
        roots: gated.policy.roots,
        cwd: gated.cwd,
        cli,
        rules: () => floorRulesNow(),
      })
    : null;
  return { gated, doing, rails, questions: turn.questions ?? null };
}

export interface HandlerFacts {
  definition: AgentDefinition;
  policy: PathPolicy | null;
  gates: TurnGates;
  signal: AbortSignal;
  mapper: TurnMapper;
  requests: RequestLog;
  push: (outputs: ProviderOutput[]) => void;
  audit: ProtocolObserver | undefined;
}

function urlAsks() {
  const waiting = new Map<string, AbortController>();
  return {
    async around<T>(
      id: string | null,
      agentCancel: AbortSignal,
      ask: (cancel: AbortSignal) => Promise<T>,
    ) {
      const done = new AbortController();
      if (id) waiting.set(id, done);
      try {
        return await ask(AbortSignal.any([agentCancel, done.signal]));
      } finally {
        if (id && waiting.get(id) === done) waiting.delete(id);
      }
    },
    complete: (id: string) => waiting.get(id)?.abort(),
  };
}

export function turnHandlers(facts: HandlerFacts): TurnHandlers {
  const { definition, policy, signal, mapper, push } = facts;
  const { gated, doing, rails, questions } = facts.gates;
  const report = (name: string) => push(mapper.clientAction(name));
  const secretRead = (label: string) => push([{ kind: 'secret_read', paths: [label] }]);
  const addresses = urlAsks();
  const context = (
    requestId: QuestionContext['requestId'],
    agentCancel: AbortSignal,
  ): QuestionContext => ({
    gate: questions,
    agent: definition.name,
    requestId,
    signal,
    agentCancel,
    note: (text) => push(mapper.note(text)),
    roots: policy?.roots.map((root) => root.path) ?? [],
  });
  return {
    audit: facts.audit,
    async permission(params, requestId) {
      rails?.asked(params.toolCall.toolCallId);
      if (signal.aborted) return { outcome: { outcome: 'cancelled' } };
      if (doing) return reviewPermission(params, requestId, doing);
      const plan = policy ? nativePlan(params, definition.id, mapper.shownPlan()) : [];
      if (gated && plan.length === 0 && readingTurnReviews(params)) {
        return reviewPermission(params, requestId, gated);
      }
      const decision = declineInConversation(params, policy !== null);
      push(plan.length > 0 ? plan : mapper.clientAction(decision.note));
      return decision.response;
    },
    question: (params, requestId, agentCancel) => {
      if (params.mode !== 'url') return askQuestion(params, context(requestId, agentCancel));
      return addresses.around(elicitationIdOf(params), agentCancel, (cancel) =>
        askToOpen(params, context(requestId, cancel)),
      );
    },
    complete: (elicitationId) => addresses.complete(elicitationId),
    write: (params) =>
      doing ? writeWithApproval(params, doing) : refuseWrite(params, policy !== null, report),
    read: (params) => {
      if (!policy) throw acp.RequestError.methodNotFound(acp.methods.client.fs.readTextFile);
      return readTextFile(policy, params, report, secretRead);
    },
    account(account) {
      if (definition.reportsModelAccess) push([{ kind: 'account', account }]);
    },
    request(usage) {
      facts.requests.see(usage);
      push([{ kind: 'request_usage', request: usage }]);
    },
  };
}
