import './ask-card.css';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { CHECKPOINT_OPTION } from '@spark-outpost/contracts';
import type { Decide } from './card-parts.tsx';
import { askKeyAction, type AskTarget } from './ask-keys.ts';
import { ClarifyFoot, holdOnField } from './clarify-parts.tsx';
import {
  clarifyAnswer,
  NO_ANSWER,
  offers,
  quickPicks,
  togglePick,
  type CheckpointApproval,
  type QuestionAnswer,
} from './checkpoint-model.ts';
import { ASK_ROW, AnswerBox, QuestionLine, QuestionPanel } from './QuestionPanel.tsx';

const OWN_WORDS = 'data-ask-own';

function focusOnMount(element: HTMLTextAreaElement | null) {
  element?.focus();
}

function askTarget(target: EventTarget): AskTarget {
  if (!(target instanceof HTMLElement)) return 'other';
  if (target.hasAttribute(OWN_WORDS)) return 'own-words';
  const row = target.getAttribute(ASK_ROW);
  return row === 'option' || row === 'answer' ? row : 'other';
}

function caretAtStart(target: EventTarget): boolean {
  return (
    target instanceof HTMLTextAreaElement &&
    target.selectionStart === 0 &&
    target.selectionEnd === 0
  );
}

function moveFocus(form: HTMLFormElement, from: EventTarget, by: number): boolean {
  const rows = [...form.querySelectorAll<HTMLElement>(`[${ASK_ROW}]`)];
  const next = rows[rows.indexOf(from as HTMLElement) + by];
  next?.focus();
  return next !== undefined;
}

function OwnWords({
  value,
  onChange,
  hold,
}: {
  value: string;
  onChange(value: string): void;
  hold(): void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!open) {
    return (
      <button
        type="button"
        className="ask-line ask-own-words"
        onClick={() => {
          hold();
          setOpen(true);
        }}
      >
        Answer in your own words
      </button>
    );
  }
  return (
    <>
      <label htmlFor={id} className="sr-only">
        Answer in your own words
      </label>
      <AnswerBox
        ref={focusOnMount}
        id={id}
        className="ask-own-words"
        placeholder="Answer in your own words"
        value={value}
        {...{ [OWN_WORDS]: '' }}
        onChange={(event) => {
          hold();
          onChange(event.target.value);
        }}
      />
    </>
  );
}

export function QuestionsBody({
  approval,
  decide,
}: {
  approval: CheckpointApproval;
  decide: Decide;
}) {
  const questions = approval.payload.checkpoint.questions;
  const [answers, setAnswers] = useState<QuestionAnswer[]>(() => questions.map(() => NO_ANSWER));
  const [active, setActive] = useState(0);
  const [ownWords, setOwnWords] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const focusActive = useRef(false);
  const total = questions.length;
  const last = total - 1;
  const reply = clarifyAnswer(questions, answers, ownWords);

  useEffect(() => {
    if (!focusActive.current) return;
    focusActive.current = false;
    form.current?.querySelector<HTMLElement>(`[${ASK_ROW}]`)?.focus();
  }, [active]);

  const answer = (index: number, value: QuestionAnswer) => {
    decide.hold();
    setAnswers((current) => current.map((old, at) => (at === index ? value : old)));
  };
  const open = (index: number) => {
    decide.hold();
    focusActive.current = true;
    setActive(index);
  };
  const asked = approval.payload.form !== undefined;
  const canSend = asked || reply !== '';
  const send = () => {
    if (!canSend || decide.busy) return;
    if (!asked) return decide(CHECKPOINT_OPTION.answer, reply);
    const sent = answers.map((given) => ({ picks: [...given.picks], text: given.text }));
    decide(CHECKPOINT_OPTION.answer, reply || undefined, sent);
  };
  const pick = (index: number) => {
    const question = questions[active];
    const picked = question && quickPicks(question)[index];
    if (picked) answer(active, togglePick(answers[active] ?? NO_ANSWER, picked, question));
    return picked !== undefined;
  };
  const keys = (event: KeyboardEvent<HTMLFormElement>) => {
    const action = askKeyAction({
      key: event.key,
      shift: event.shiftKey,
      modifier: event.metaKey || event.ctrlKey || event.altKey,
      composing: event.nativeEvent.isComposing,
      target: askTarget(event.target),
      caretAtStart: caretAtStart(event.target),
    });
    if (!action) return;
    if (action.kind === 'move') {
      if (moveFocus(event.currentTarget, event.target, action.by)) event.preventDefault();
      return;
    }
    if (action.kind === 'pick') {
      if (pick(action.index)) event.preventDefault();
      return;
    }
    event.preventDefault();
    if (action.kind === 'onward' && active < last) open(active + 1);
    else send();
  };

  return (
    <form
      ref={form}
      className="ck-questions"
      onFocus={holdOnField(decide.hold)}
      onKeyDown={keys}
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <div className="ask-scroll">
        <ol className="ask-list">
          {questions.map((question, index) => (
            <li key={question.question}>
              {index === active ? (
                <QuestionPanel
                  question={question}
                  number={index + 1}
                  total={total}
                  answer={answers[index] ?? NO_ANSWER}
                  onAnswer={(value) => answer(index, value)}
                />
              ) : (
                <QuestionLine
                  question={question}
                  number={index + 1}
                  total={total}
                  answer={answers[index] ?? NO_ANSWER}
                  onOpen={() => open(index)}
                />
              )}
            </li>
          ))}
        </ol>
      </div>
      {offers(approval, CHECKPOINT_OPTION.answer) && !asked && (
        <OwnWords value={ownWords} onChange={setOwnWords} hold={decide.hold} />
      )}
      <div className="appr-acts ck-foot">
        <button type="submit" className="btn primary sm" disabled={decide.busy || !canSend}>
          Send
        </button>
        <ClarifyFoot approval={approval} decide={decide} />
      </div>
    </form>
  );
}
