import type { ConversationDetail, MemberMessage, Orchestration } from '@spark-outpost/contracts';
import { isBusy, isDispatcher, type CrewAgent } from './crew-model.ts';
import { runAgent } from './crew-projection.ts';

export interface FoundMember {
  agent: CrewAgent;
  orchestration: Orchestration;
}

const CONTINUABLE = new Set(['builder', 'integrator']);

export function findMember(
  detail: ConversationDetail | undefined,
  runId: string,
): FoundMember | null {
  for (const orchestration of Object.values(detail?.orchestrations ?? {})) {
    const member = orchestration.crew.find((entry) => entry.runId === runId);
    if (member) {
      return {
        agent: runAgent(member, orchestration, detail?.activity[runId] ?? []),
        orchestration,
      };
    }
  }
  return null;
}

export function memberIsLive(agent: Pick<CrewAgent, 'state'>): boolean {
  return isBusy(agent.state) || agent.state === 'waiting' || agent.state === 'queued';
}

export function canContinue(agent: Pick<CrewAgent, 'role'>): boolean {
  return CONTINUABLE.has(agent.role);
}

export function messageable(agent: Pick<CrewAgent, 'role' | 'state'>): boolean {
  return !isDispatcher(agent) && (memberIsLive(agent) || canContinue(agent));
}

export function messagesFor(
  detail: ConversationDetail | undefined,
  runId: string,
): MemberMessage[] {
  return (detail?.memberMessages ?? []).filter((message) => message.runId === runId);
}

export function messageState(message: MemberMessage, live: boolean, name: string): string {
  switch (message.status) {
    case 'queued':
      return live ? `${name} reads this at its next step` : `${name} finished before reading this`;
    case 'delivered':
      return `${name} has it`;
    case 'interrupting':
      return 'Stopping the turn to send this first';
    case 'sent':
      return 'Sent as your next message';
    case 'missed':
      return `${name} finished before reading this`;
    case 'continued':
      return `${name} picked this up in a new turn`;
  }
}

export function messageTone(message: MemberMessage, live: boolean): 'wait' | 'ok' | 'miss' {
  if (message.status === 'missed' || (message.status === 'queued' && !live)) return 'miss';
  if (message.status === 'queued' || message.status === 'interrupting') return 'wait';
  return 'ok';
}
