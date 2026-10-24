import { useId, type Ref } from 'react';
import { Keys } from '../../ui/Keys.tsx';
import { MAC } from '../../ui/shortcuts.ts';
import { DiscardBar } from './DiscardBar.tsx';

export type FooterStep = 'name' | 'chats' | 'review' | 'result';

interface SheetFooterProps {
  step: FooterStep;
  primaryRef: Ref<HTMLButtonElement>;
  starting: boolean;
  block: string | null;
  addsOpenChat: boolean;
  discarding: boolean;
  onBack: () => void;
  onPrimary: () => void;
  onOpenOutpost: () => void;
  onKeep: () => void;
  onDiscard: () => void;
}

const ADDS_OPEN_CHAT = 'Continue adds the open chat';
const ENTER = ['↵'] as const;
const COMMAND_ENTER = MAC ? (['⌘', '↵'] as const) : (['Ctrl', '↵'] as const);

const PRIMARY: Record<FooterStep, string> = {
  name: 'Continue',
  chats: 'Continue',
  review: 'Start outpost',
  result: 'Try again',
};

export function SheetFooter({
  step,
  primaryRef,
  starting,
  block,
  addsOpenChat,
  discarding,
  onBack,
  onPrimary,
  onOpenOutpost,
  onKeep,
  onDiscard,
}: SheetFooterProps) {
  const ids = useId();
  const blocked = step === 'chats' && block !== null;
  const hint = blocked ? block : step === 'chats' && addsOpenChat ? ADDS_OPEN_CHAT : null;

  if (discarding) {
    return <DiscardBar question="Discard this outpost?" onKeep={onKeep} onDiscard={onDiscard} />;
  }

  return (
    <footer className="op-sheet-foot op-create-foot">
      {step === 'result' ? (
        <button type="button" className="btn sm ghost" onClick={onOpenOutpost}>
          Open outpost
        </button>
      ) : (
        <button type="button" className="btn sm ghost" disabled={starting} onClick={onBack}>
          {step === 'name' ? 'Cancel' : 'Back'}
        </button>
      )}
      <span id={`${ids}hint`} className={blocked ? 'op-foot-hint bad' : 'op-foot-hint'}>
        {hint}
      </span>
      <button
        ref={primaryRef}
        type="button"
        className="btn sm primary"
        disabled={blocked || starting}
        aria-describedby={hint ? `${ids}hint` : undefined}
        onClick={onPrimary}
      >
        {starting ? 'Starting…' : PRIMARY[step]}
        {!starting && <Keys keys={step === 'chats' ? COMMAND_ENTER : ENTER} />}
      </button>
    </footer>
  );
}
