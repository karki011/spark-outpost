import {
  waitedOn,
  type BackgroundWait,
  type BusyEnterAction,
  type MemberMessage,
  type Run,
} from '@spark-outpost/contracts';

export interface ModifierKeys {
  metaKey: boolean;
  ctrlKey: boolean;
}

interface SendChoice {
  label: string;
  note: string;
  hint: string;
}

export const SEND_CHOICES: Record<BusyEnterAction, SendChoice> = {
  queue: { label: 'Queue', note: 'Sends when this turn ends', hint: 'queue' },
  now: { label: 'Send now', note: 'Steers or interrupts the turn', hint: 'send now' },
};

export const SEND_CHOICE_ORDER: readonly BusyEnterAction[] = ['queue', 'now'];

export function otherAction(action: BusyEnterAction): BusyEnterAction {
  return action === 'queue' ? 'now' : 'queue';
}

export function enterAction(keys: ModifierKeys, preferred: BusyEnterAction): BusyEnterAction {
  return keys.metaKey || keys.ctrlKey ? otherAction(preferred) : preferred;
}

export function modifiedEnter(mac: boolean): string {
  return mac ? '⌘Enter' : 'Ctrl+Enter';
}

export function choiceKey(action: BusyEnterAction, preferred: BusyEnterAction, mac: boolean) {
  return action === preferred ? 'Enter' : modifiedEnter(mac);
}

export function enterWhileBusy(preferred: BusyEnterAction, waitingOn: number): BusyEnterAction {
  return waitingOn > 0 ? 'now' : preferred;
}

export function busyHint(
  preferred: BusyEnterAction,
  mac: boolean,
  waitingOn = 0,
  background: BackgroundWait | null = null,
): string {
  if (waitingOn > 0) {
    const waits = `while it waits on ${waitedOn(waitingOn, background)}`;
    return `Enter to send to the agent now, ${waits} · ${modifiedEnter(mac)} to queue`;
  }
  const other = otherAction(preferred);
  return `Enter to ${SEND_CHOICES[preferred].hint} · ${modifiedEnter(mac)} to ${SEND_CHOICES[other].hint}`;
}

const WAITING_NOW_NOTE = 'Reaches the agent while it waits, or joins the queue';

export function choiceNote(action: BusyEnterAction, waiting: boolean): string {
  return waiting && action === 'now' ? WAITING_NOW_NOTE : SEND_CHOICES[action].note;
}

export function choiceTitle(
  action: BusyEnterAction,
  preferred: BusyEnterAction,
  mac: boolean,
  waiting = false,
) {
  const note = choiceNote(action, waiting).toLowerCase();
  return `${SEND_CHOICES[action].label}: ${note} (${choiceKey(action, preferred, mac)})`;
}

const ACTIVE = new Set<Run['status']>(['queued', 'running', 'awaiting_approval']);

interface SendNowFacts {
  memberMessages?: readonly MemberMessage[] | undefined;
  runs: readonly Pick<Run, 'id' | 'status' | 'userMessageId'>[];
}

export function sendNowStatus({ memberMessages = [], runs }: SendNowFacts): string | null {
  const message = memberMessages.findLast(
    (entry) => entry.urgency === 'now' && runs.some((run) => run.id === entry.runId),
  );
  if (!message) return null;
  const steered = runs.find((run) => run.id === message.runId);
  const steeredLive = steered !== undefined && ACTIVE.has(steered.status);
  switch (message.status) {
    case 'queued':
      return steeredLive ? 'Sending to the running turn…' : null;
    case 'interrupting':
      return 'Stopping the turn to send your message…';
    case 'sent': {
      const next = runs.find((run) => run.userMessageId === message.id);
      if (!next || !ACTIVE.has(next.status)) return null;
      return steered?.status === 'cancelled'
        ? 'Stopped the turn to send your message'
        : 'Sent as your next message';
    }
    default:
      return null;
  }
}
