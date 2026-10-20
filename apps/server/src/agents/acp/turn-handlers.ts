import * as acp from '@agentclientprotocol/sdk';
import type { PathPolicy } from '../../projects/path-policy.ts';
import type { ProtocolObserver, ProviderOutput, ProviderTurn } from '../../providers/provider.ts';
import type { AgentDefinition } from './agents.ts';
import {
  reviewPermission,
  runsCommand,
  writeWithApproval,
  type DoWorkspace,
} from './do-handlers.ts';
import { readTextFile, refuseWrite } from './fs-handlers.ts';
import type { TurnHandlers } from './live-binding.ts';
import { declineInConversation, nativePlan } from './permissions.ts';
import { createRailWatch, type RailWatch } from './rail-watch.ts';
import type { RequestLog } from './turn-loop.ts';
import type { TurnMapper } from './subagent-updates.ts';

export interface TurnGates {
  gated: DoWorkspace | null;
  doing: DoWorkspace | null;
  rails: RailWatch | null;
}

export function turnGates(
  policy: PathPolicy | null,
  cwd: string,
  changing: boolean,
  turn: ProviderTurn,
  signal: AbortSignal,
  mapper: TurnMapper,
  push: (outputs: ProviderOutput[]) => void,
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
  const rails = gated ? createRailWatch({ roots: gated.policy.roots, cwd: gated.cwd }) : null;
  return { gated, doing, rails };
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

export function turnHandlers(facts: HandlerFacts): TurnHandlers {
  const { definition, policy, signal, mapper, push } = facts;
  const { gated, doing, rails } = facts.gates;
  const report = (name: string) => push(mapper.clientAction(name));
  const secretRead = (label: string) => push([{ kind: 'secret_read', paths: [label] }]);
  return {
    audit: facts.audit,
    async permission(params, requestId) {
      rails?.asked(params.toolCall.toolCallId);
      if (signal.aborted) return { outcome: { outcome: 'cancelled' } };
      if (doing) return reviewPermission(params, requestId, doing);
      const plan = policy ? nativePlan(params, definition.id, mapper.shownPlan()) : [];
      if (gated && plan.length === 0 && runsCommand(params)) {
        return reviewPermission(params, requestId, gated);
      }
      const decision = declineInConversation(params, policy !== null);
      push(plan.length > 0 ? plan : mapper.clientAction(decision.note));
      return decision.response;
    },
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
