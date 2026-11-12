import type { NewMeetingLine } from '@spark-outpost/contracts';
import type { MeetingSource } from './source.ts';

const DEFAULT_INTERVAL_MS = 150;
const LINE_SPAN_MS = 4_000;

const SCRIPT: ReadonlyArray<Pick<NewMeetingLine, 'speaker' | 'text'>> = [
  { speaker: 'others', text: 'Thanks for joining. Today we are reviewing the new pricing tiers.' },
  {
    speaker: 'you',
    text: 'Before we start, can we look at how churn moved after the last change?',
  },
  {
    speaker: 'others',
    text: 'Churn dropped two points on the annual plan and stayed flat on monthly.',
  },
  { speaker: 'you', text: 'Then the monthly price is not what drives people away.' },
  {
    speaker: 'others',
    text: 'Agreed. The proposal is to raise the team tier by ten percent in January.',
  },
  { speaker: 'you', text: 'I would keep existing customers on their price until the renewal.' },
  {
    speaker: 'others',
    text: 'That works. We will announce it in December and apply it in January.',
  },
  { speaker: 'you', text: 'Good. I will write up the plan and share it tomorrow.' },
];

export function fakeMeetingSource(env: NodeJS.ProcessEnv): MeetingSource | null {
  if (env.SPARK_FAKE_MEETINGS !== '1') return null;
  const requested = Number(env.SPARK_FAKE_MEETINGS_INTERVAL_MS);
  const intervalMs = Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_INTERVAL_MS;
  const timers = new Map<string, ReturnType<typeof setInterval>>();

  const stop = async (meetingId: string) => {
    clearInterval(timers.get(meetingId));
    timers.delete(meetingId);
  };

  return {
    async start(meetingId, deliver) {
      await stop(meetingId);
      let next = 0;
      const timer = setInterval(() => {
        const line = SCRIPT[next];
        if (!line || timers.get(meetingId) !== timer) {
          clearInterval(timer);
          return;
        }
        const startMs = next * LINE_SPAN_MS;
        next += 1;
        if (next >= SCRIPT.length) clearInterval(timer);
        void deliver([{ ...line, startMs, endMs: startMs + LINE_SPAN_MS - 500 }]).catch(
          () => undefined,
        );
      }, intervalMs);
      timers.set(meetingId, timer);
    },
    stop,
  };
}
