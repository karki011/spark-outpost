import type { WideWindowLayout } from '@spark-outpost/contracts';
import { forgetPanelChoice } from '../tasks/work-panel-state.ts';
import { ProfileChoiceSetting, type ProfileChoice } from './ProfileChoiceSetting.tsx';

const CHOICES: ProfileChoice<WideWindowLayout>[] = [
  { id: 'rail', label: 'Context rail', value: 'rail' },
  { id: 'panel', label: 'Work panel', value: 'panel' },
  { id: 'empty', label: 'Empty margin', value: 'empty' },
];

const HINTS: Record<WideWindowLayout, string> = {
  rail: 'A quiet rail beside the chat shows its project, agent, changes and an outline while the work panel is closed.',
  panel:
    'Chats with a task open the work panel when the window is wide. Closing it yourself still sticks.',
  empty: 'Nothing fills the space beside the chat. Open the work panel when you want it.',
};

export function WideWindowSetting({ layout }: { layout: WideWindowLayout }) {
  return (
    <ProfileChoiceSetting
      saved={layout}
      choices={CHOICES}
      label="On wide windows"
      hint={(value) => HINTS[value]}
      toUpdate={(value) => ({ wideWindow: value })}
      onPick={forgetPanelChoice}
    />
  );
}
