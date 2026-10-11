import { useEffect, useId, useRef, type Ref } from 'react';
import { Keys } from '../../ui/Keys.tsx';
import { MAC } from '../../ui/shortcuts.ts';

export type FooterStep = 'name' | 'chats' | 'review' | 'result';

interface SheetFooterProps {
  step: FooterStep;
  primaryRef: Ref<HTMLButtonElement>;
  starting: boolean;
  block: string | null;
  addsOpenChat: boolean;
  discarding: boolean;
  adding?: boolean;
  onBack: () => void;
  onPrimary: () => void;
  onOpenOutpost: () => void;
  onKeep: () => void;
  onDiscard: () => void;
}

const ADDS_OPEN_CHAT = 'Continue adds the open chat';
const ADD_CHATS = 'Start chats';
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
  adding = false,
  onBack,
  onPrimary,
  onOpenOutpost,
  onKeep,
  onDiscard,
}: SheetFooterProps) {
  const ids = useId();
  const keepRef = useRef<HTMLButtonElement>(null);
  const blocked = step === 'chats' && block !== null;
  const hint = blocked ? block : step === 'chats' && addsOpenChat ? ADDS_OPEN_CHAT : null;

  useEffect(() => {
    if (discarding) keepRef.current?.focus();
  }, [discarding]);

  if (discarding) {
    return (
      <footer className="op-sheet-foot op-create-foot" role="alertdialog" aria-labelledby={ids}>
        <span id={ids} className="op-foot-ask">
          {adding ? 'Discard these chats?' : 'Discard this outpost?'}
        </span>
        <button ref={keepRef} type="button" className="btn sm ghost" onClick={onKeep}>
          Keep editing
        </button>
        <button type="button" className="btn sm line" onClick={onDiscard}>
          Discard
        </button>
      </footer>
    );
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
        {starting ? 'Starting…' : adding && step === 'review' ? ADD_CHATS : PRIMARY[step]}
        {!starting && <Keys keys={step === 'chats' ? COMMAND_ENTER : ENTER} />}
      </button>
    </footer>
  );
}
