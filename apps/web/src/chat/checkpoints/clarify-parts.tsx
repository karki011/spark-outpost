import type { FocusEvent } from 'react';
import { CHECKPOINT_OPTION } from '@spark-outpost/contracts';
import { Action, type Decide } from './card-parts.tsx';
import { optionName, type CheckpointApproval } from './checkpoint-model.ts';

export function holdOnField(hold: () => void) {
  return (event: FocusEvent<HTMLElement>) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      hold();
    }
  };
}

export function ClarifyFoot({
  approval,
  decide,
}: {
  approval: CheckpointApproval;
  decide: Decide;
}) {
  return (
    <>
      <Action id={CHECKPOINT_OPTION.useDefaults} approval={approval} decide={decide} kind="quiet">
        {optionName(approval, CHECKPOINT_OPTION.useDefaults)}
      </Action>
      <Action id={CHECKPOINT_OPTION.clarifyRules} approval={approval} decide={decide} kind="quiet">
        Let the rules decide
      </Action>
      <Action id={CHECKPOINT_OPTION.finish} approval={approval} decide={decide} kind="quiet">
        {optionName(approval, CHECKPOINT_OPTION.finish)}
      </Action>
      <Action id={CHECKPOINT_OPTION.stop} approval={approval} decide={decide} kind="stop">
        Stop
      </Action>
    </>
  );
}
