import '../outposts.css';
import '../outpost-sheet.css';
import './outpost-create.css';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { FailedMember } from '@spark-outpost/contracts';
import { wrapTabFocus } from '../../ui/focus-trap.ts';
import { XIcon } from '../../ui/icons.tsx';
import { OutpostFaces } from '../MemberFace.tsx';
import {
  hasUnsavedInput,
  listedChats,
  settled,
  type ChatDraft,
  type CreateDraft,
} from './create-draft.ts';
import { faceIds } from './create-labels.ts';
import { continueBlock, isFinished, nameProblem } from './create-problems.ts';
import { SheetFooter } from './SheetFooter.tsx';
import { StartResult } from './StartResult.tsx';
import { StepChats, type DraftChange } from './StepChats.tsx';
import { StepName } from './StepName.tsx';
import { Stepper } from './Stepper.tsx';
import { StepReview } from './StepReview.tsx';
import type { CreateData } from './use-create-data.ts';

interface CreateSheetProps {
  initial: CreateDraft;
  draft: CreateDraft;
  data: CreateData;
  starting: boolean;
  failure: string | null;
  failed: readonly FailedMember[] | null;
  onChange: (change: DraftChange) => void;
  onStart: () => void;
  onOpenOutpost: () => void;
  onClose: () => void;
}

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]):not([hidden]), textarea, [tabindex]:not([tabindex="-1"])';
const NAME = 0;
const CHATS = 1;
const REVIEW = 2;

function shown(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => !element.closest('[hidden]'),
  );
}

function typedInField(event: KeyboardEvent): boolean {
  return event.target instanceof HTMLInputElement && event.target.type !== 'file';
}

export function CreateSheet(props: CreateSheetProps) {
  const { initial, draft, data, starting, failed, onChange } = props;
  const ids = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const into = draft.into ?? null;
  const [step, setStep] = useState(into ? CHATS : NAME);
  const [nameTried, setNameTried] = useState(false);
  const [chatsFocus, setChatsFocus] = useState(into ? 1 : 0);
  const [discarding, setDiscarding] = useState(false);
  const block = continueBlock(draft, data.chats);
  const finished = (chat: ChatDraft, current: CreateDraft) => isFinished(chat, current, data.chats);
  const openFinished = draft.chats.some((chat) => chat.open && finished(chat, draft));

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => opener?.focus();
  }, []);

  useEffect(() => {
    if (step === NAME) nameRef.current?.focus();
    if (step === REVIEW) primaryRef.current?.focus();
  }, [step]);

  const goTo = (next: number) => {
    setStep(next);
    if (next === CHATS) setChatsFocus((count) => count + 1);
  };

  const leaveName = () => {
    setNameTried(true);
    if (nameProblem(draft.name) === null) goTo(CHATS);
  };

  const settle = () => onChange((current) => settled(current, (chat) => finished(chat, current)));

  const leaveChats = () => {
    if (block !== null) return;
    settle();
    goTo(REVIEW);
  };

  const primary = () => {
    if (starting) return;
    if (failed) props.onStart();
    else if (step === NAME) leaveName();
    else if (step === CHATS) leaveChats();
    else props.onStart();
  };

  const enter = () => {
    if (step !== CHATS || !openFinished) {
      primary();
      return;
    }
    settle();
    setChatsFocus((count) => count + 1);
  };

  const requestClose = () => {
    if (starting) return;
    if (failed) props.onOpenOutpost();
    else if (hasUnsavedInput(initial, draft) && !discarding) setDiscarding(true);
    else props.onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.stopPropagation();
      if (discarding) setDiscarding(false);
      else requestClose();
      return;
    }
    if (event.key === 'Enter' && !event.nativeEvent.isComposing && !event.defaultPrevented) {
      const commanded = event.metaKey || event.ctrlKey;
      if (commanded || typedInField(event)) {
        event.preventDefault();
        if (commanded) primary();
        else enter();
        return;
      }
    }
    const panel = event.currentTarget;
    wrapTabFocus(event, () => shown(panel));
  };

  return (
    <div
      className="op-scrim"
      onMouseDown={(event) => event.target === event.currentTarget && requestClose()}
    >
      <div
        className="op-sheet op-create"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${ids}title`}
        onKeyDown={onKeyDown}
      >
        <header className="op-sheet-head">
          <h2 id={`${ids}title`}>{into ? `Add chats to ${into.name}` : 'New outpost'}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={requestClose}>
            <XIcon />
          </button>
        </header>
        <Stepper current={failed ? REVIEW + 1 : step} />
        <div className="op-sheet-body">
          <OutpostFaces listed={faceIds(listedChats(draft))}>
            {failed && <StartResult name={draft.name.trim()} failed={failed} />}
            {!failed && step === NAME && (
              <StepName
                inputRef={nameRef}
                name={draft.name}
                problem={nameTried ? nameProblem(draft.name) : null}
                locked={into !== null}
                onName={(name) => onChange((current) => ({ ...current, name }))}
              />
            )}
            <StepChats
              draft={draft}
              data={data}
              hidden={failed !== null || step !== CHATS}
              focusSignal={chatsFocus}
              onChange={onChange}
            />
            {!failed && step === REVIEW && (
              <StepReview
                draft={draft}
                data={data}
                onEditName={() => goTo(NAME)}
                onEditChats={() => goTo(CHATS)}
              />
            )}
          </OutpostFaces>
        </div>
        {props.failure && (
          <p className="op-sheet-failure" role="alert">
            {props.failure}
          </p>
        )}
        <SheetFooter
          step={failed ? 'result' : step === NAME ? 'name' : step === CHATS ? 'chats' : 'review'}
          primaryRef={primaryRef}
          starting={starting}
          block={block}
          addsOpenChat={openFinished}
          discarding={discarding}
          adding={into !== null}
          onBack={() => (step === NAME ? requestClose() : goTo(step - 1))}
          onPrimary={primary}
          onOpenOutpost={props.onOpenOutpost}
          onKeep={() => setDiscarding(false)}
          onDiscard={props.onClose}
        />
      </div>
    </div>
  );
}
