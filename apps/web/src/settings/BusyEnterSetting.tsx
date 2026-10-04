import type { BusyEnterAction } from '@spark-outpost/contracts';
import { modifiedEnter } from '../chat/queue/send-choice.ts';
import { MAC } from '../ui/shortcuts.ts';
import { ProfileChoiceSetting, type ProfileChoice } from './ProfileChoiceSetting.tsx';

const CHOICES: ProfileChoice<BusyEnterAction>[] = [
  { id: 'queue', label: 'Queues the message', value: 'queue' },
  { id: 'now', label: 'Sends it now', value: 'now' },
];

const OTHER_KEY = modifiedEnter(MAC);

const HINTS: Record<BusyEnterAction, string> = {
  queue: `Your message waits and sends when the turn ends. ${OTHER_KEY} sends it now instead.`,
  now: `The agent reads it mid-turn, or the turn stops and your message goes first. ${OTHER_KEY} queues it instead.`,
};

export function BusyEnterSetting({ action }: { action: BusyEnterAction }) {
  return (
    <ProfileChoiceSetting
      saved={action}
      choices={CHOICES}
      label="While the agent is working, Enter"
      hint={(value) => HINTS[value]}
      doc={{ page: 'follow-a-turn', heading: 'queue-messages' }}
      toUpdate={(value) => ({ busyEnter: value })}
    />
  );
}
