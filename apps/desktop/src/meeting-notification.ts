import { Notification, type NotificationConstructorOptions } from 'electron';
import type { MeetingAlertPayload } from '@spark-outpost/contracts';

export type NoticeChoice =
  { kind: 'join'; eventKey: string } | { kind: 'snooze' } | { kind: 'show' };

interface NoticeAction {
  label: string;
  choice: NoticeChoice;
}

export interface NoticePlan {
  title: string;
  body: string;
  actions: NoticeAction[];
}

export function noticePlan(payload: MeetingAlertPayload): NoticePlan {
  const [first] = payload.events;
  const joinable = payload.events.length === 1 && first?.link ? first : null;
  const lead: NoticeAction = joinable
    ? { label: 'Join', choice: { kind: 'join', eventKey: joinable.key } }
    : { label: 'Show', choice: { kind: 'show' } };
  return {
    title: payload.notice.title,
    body: payload.notice.body,
    actions: [lead, { label: 'Snooze 1 min', choice: { kind: 'snooze' } }],
  };
}

export interface NoticeHandle {
  on(event: 'action', listener: (details: { actionIndex?: number }, index?: number) => void): void;
  on(event: 'click' | 'show', listener: () => void): void;
  on(event: 'failed', listener: (event: unknown, error: string) => void): void;
  show(): void;
  close(): void;
}

export interface NoticeDeps {
  supported(): boolean;
  create(options: NotificationConstructorOptions): NoticeHandle;
  log(line: string): void;
}

export interface MeetingNotifier {
  post(payload: MeetingAlertPayload, onChoice: (choice: NoticeChoice) => void): void;
  close(): void;
}

export const electronNotices = (log: (line: string) => void): NoticeDeps => ({
  supported: () => Notification.isSupported(),
  create: (options) => new Notification(options),
  log,
});

export function meetingNotifier(deps: NoticeDeps): MeetingNotifier {
  let shownKey: string | null = null;
  let current: NoticeHandle | null = null;

  const close = () => {
    current?.close();
    current = null;
    shownKey = null;
  };

  const post = (payload: MeetingAlertPayload, onChoice: (choice: NoticeChoice) => void) => {
    if (payload.key === shownKey) return;
    close();
    if (!deps.supported()) return;
    const plan = noticePlan(payload);
    const notice = deps.create({
      title: plan.title,
      body: plan.body,
      silent: true,
      actions: plan.actions.map((action) => ({ type: 'button', text: action.label })),
    });
    notice.on('action', (details, index) => {
      const chosen = plan.actions[details?.actionIndex ?? index ?? -1];
      if (chosen) onChoice(chosen.choice);
    });
    notice.on('click', () => onChoice({ kind: 'show' }));
    notice.on('show', () => deps.log('Meeting notification posted.'));
    notice.on('failed', (_event, error) =>
      deps.log(`Could not show the meeting notification: ${error}`),
    );
    current = notice;
    shownKey = payload.key;
    notice.show();
  };

  return { post, close };
}
