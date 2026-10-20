import type * as acp from '@agentclientprotocol/sdk';
import type {
  ProviderOutput,
  ProviderTurn,
  RequestUsage,
  SteerRequests,
} from '../../providers/provider.ts';
import { endsAgentCycle, type BackgroundCount, type BackgroundWork } from './background-work.ts';
import { followUpBlocks } from './conversation-prompt.ts';
import { createIdleInbox, deliveringWhenIdle, type IdleInbox } from './idle-inbox.ts';
import { nextMessage, untilFailure } from './steering.ts';
import type { TurnMapper } from './subagent-updates.ts';
import type { TurnTokens } from './turn-tokens.ts';

type SessionMessage = Awaited<ReturnType<acp.ActiveSession['nextUpdate']>>;
type FollowUpOptions = Parameters<typeof followUpBlocks>[1];

export interface RequestLog {
  see(request: RequestUsage): void;
  take(): RequestUsage[];
}

export function createRequestLog(): RequestLog {
  const requests = new Map<string, RequestUsage>();
  return {
    see(request) {
      requests.set(request.key, request);
    },
    take() {
      const taken = [...requests.values()];
      requests.clear();
      return taken;
    },
  };
}

export interface PromptLoop {
  session: Pick<acp.ActiveSession, 'prompt' | 'nextUpdate'>;
  blocks: acp.ContentBlock[] | null;
  followUp: FollowUpOptions;
  turn: ProviderTurn;
  signal: AbortSignal;
  mapper: TurnMapper;
  tokens: TurnTokens;
  requests: RequestLog;
  push: (outputs: ProviderOutput[]) => void;
  see: (update: acp.SessionUpdate) => Promise<void>;
  background: BackgroundWork | null;
  steers: boolean;
  steer: (steering: SteerRequests | undefined) => () => void;
}

type Woken =
  { kind: 'message'; message: SessionMessage } | { kind: 'delivered' } | { kind: 'aborted' };

function abortion(signal: AbortSignal): Promise<Woken> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve({ kind: 'aborted' });
    else signal.addEventListener('abort', () => resolve({ kind: 'aborted' }), { once: true });
  });
}

const never = new Promise<never>(() => undefined);

function readNext(session: PromptLoop['session']): Promise<SessionMessage> {
  const next = session.nextUpdate();
  next.catch(() => undefined);
  return next;
}

export async function runPrompts(loop: PromptLoop): Promise<acp.StopReason> {
  const { turn, background, steers } = loop;
  const inbox = createIdleInbox(background && !steers ? turn.steering : undefined);
  const steering = background ? deliveringWhenIdle(turn.steering, inbox) : turn.steering;
  const detach = loop.steer(steering);
  try {
    return await converse(loop, inbox);
  } finally {
    inbox.close();
    detach();
  }
}

async function converse(loop: PromptLoop, inbox: IdleInbox): Promise<acp.StopReason> {
  const { session, signal, mapper, push, background } = loop;
  const aborted = abortion(signal);
  let failure: Promise<never> = loop.blocks ? untilFailure(session.prompt(loop.blocks)) : never;
  let pending = readNext(session);
  let waiting = false;
  let delivered: Promise<Woken> = never;
  let shown = '';

  const report = (count: BackgroundCount) => {
    const key = JSON.stringify(count);
    if (key === shown) return;
    shown = key;
    push([{ kind: 'background_work', ...count }]);
  };
  const sendPrompt = (text: string) => {
    failure = untilFailure(session.prompt(followUpBlocks(text, loop.followUp)));
  };
  const startWaiting = () => {
    waiting = true;
    inbox.open();
    delivered = inbox.arrived().then(() => ({ kind: 'delivered' }));
    if (background) report(background.count());
  };
  const stopWaiting = () => {
    waiting = false;
    inbox.close();
    delivered = never;
    report({ agents: 0, tasks: 0, names: [] });
  };

  if (!loop.blocks) startWaiting();
  for (;;) {
    const woken = await Promise.race([
      pending.then((message): Woken => ({ kind: 'message', message })),
      failure,
      delivered,
      waiting ? aborted : never,
    ]);
    if (woken.kind === 'aborted') return 'cancelled';
    if (woken.kind === 'delivered') {
      const text = inbox.take();
      stopWaiting();
      if (text) sendPrompt(text);
      continue;
    }
    pending = readNext(session);
    const { message } = woken;
    if (message.kind === 'stop') {
      push(loop.tokens.add(message.response, mapper.takeSubagentTokens()));
      loop.requests.take();
      mapper.stopped(message.response._meta);
      const next = await nextMessage(loop.turn, message.stopReason, signal);
      if (next) {
        sendPrompt(next);
        continue;
      }
      const goesOn = message.stopReason === 'end_turn' && !signal.aborted && background?.busy();
      if (!goesOn) return message.stopReason;
      startWaiting();
      continue;
    }
    await loop.see(message.update);
    background?.see(message.update);
    if (!waiting) continue;
    const count = background?.count();
    if (count && count.agents + count.tasks > 0) report(count);
    if (!endsAgentCycle(message.update)) continue;
    push(loop.tokens.addCycle(loop.requests.take(), mapper.takeSubagentTokens()));
    if (!background?.busy()) {
      stopWaiting();
      return 'end_turn';
    }
  }
}
