import './ask-card.css';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CHECKPOINT_OPTION } from '@spark-outpost/contracts';
import { Keys } from '../../ui/Keys.tsx';
import type { Decide } from './card-parts.tsx';
import { askKeyAction, type AskTarget } from './ask-keys.ts';
import { ClarifyFoot, holdOnField } from './clarify-parts.tsx';
import {
  choosePick,
  clarifyAnswer,
  firstAnswer,
  NO_ANSWER,
  quickPicks,
  togglePick,
  type CheckpointApproval,
  type QuestionAnswer,
} from './checkpoint-model.ts';
import { ASK_ROW, QuestionLine, QuestionPanel } from './QuestionPanel.tsx';

const TARGETS: readonly AskTarget[] = ['option', 'radio', 'answer'];

function askTarget(target: EventTarget): AskTarget {
  if (!(target instanceof HTMLElement)) return 'other';
  const row = target.getAttribute(ASK_ROW);
  return TARGETS.find((known) => known === row) ?? 'other';
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

export function guessLabel(agent: string | null): string {
  return `${agent ?? 'Spark'}’s best guess`;
}

export function QuestionsBody({
  approval,
  decide,
}: {
  approval: CheckpointApproval;
  decide: Decide;
}) {
  const checkpoint = approval.payload.checkpoint;
  const questions = checkpoint.questions;
  const [answers, setAnswers] = useState<QuestionAnswer[]>(() => questions.map(firstAnswer));
  const [active, setActive] = useState(0);
  const form = useRef<HTMLFormElement>(null);
  const focusActive = useRef(false);
  const total = questions.length;
  const last = total - 1;
  const reply = clarifyAnswer(questions, answers, '');

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
    if (!picked) return false;
    const current = answers[active] ?? NO_ANSWER;
    const single = question.pick === 'one';
    answer(active, single ? choosePick(picked) : togglePick(current, picked, question));
    return true;
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
                  guessLabel={guessLabel(checkpoint.agent)}
                  titled={total === 1}
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
      <div className="appr-acts ck-foot">
        <button
          type="submit"
          className="btn primary sm"
          aria-keyshortcuts="Enter"
          disabled={decide.busy || !canSend}
        >
          Send
          <Keys keys={['⏎']} className="key-hint" />
        </button>
        <ClarifyFoot approval={approval} decide={decide} />
      </div>
    </form>
  );
}
