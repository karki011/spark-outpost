import {
  useId,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type TextareaHTMLAttributes,
} from 'react';
import {
  CHECKPOINT_OPTION,
  clarifyOptionId,
  type CheckpointQuestion,
} from '@spark-outpost/contracts';
import { CheckIcon } from '../../ui/icons.tsx';
import { Action, NoteForm, type Decide } from './card-parts.tsx';
import {
  answeredNote,
  clarifyAnswer,
  NO_ANSWER,
  offers,
  optionName,
  quickPicks,
  sentAnswers,
  togglePick,
  type CheckpointApproval,
  type QuestionAnswer,
} from './checkpoint-model.ts';

interface BodyProps {
  approval: CheckpointApproval;
  decide: Decide;
}

function holdOnField(hold: () => void) {
  return (event: FocusEvent<HTMLElement>) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      hold();
    }
  };
}

function ClarifyFoot({ approval, decide }: BodyProps) {
  return (
    <>
      <Action id={CHECKPOINT_OPTION.useDefaults} approval={approval} decide={decide}>
        {optionName(approval, CHECKPOINT_OPTION.useDefaults)}
      </Action>
      <Action id={CHECKPOINT_OPTION.clarifyRules} approval={approval} decide={decide}>
        Let the rules decide
      </Action>
      <Action id={CHECKPOINT_OPTION.stop} approval={approval} decide={decide} kind="stop">
        Stop
      </Action>
    </>
  );
}

function sendOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

function AnswerBox({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea className={`inp ck-box ${className ?? ''}`} onKeyDown={sendOnEnter} {...props} />
  );
}

function QuestionItem({
  question,
  number,
  answer,
  onAnswer,
}: {
  question: CheckpointQuestion;
  number: number;
  answer: QuestionAnswer;
  onAnswer(answer: QuestionAnswer): void;
}) {
  const id = useId();
  return (
    <li className="ck-q">
      <p className="ck-q-text" id={`${id}-q`}>
        {question.question}
      </p>
      <p className="ck-guess">
        Best guess: <b>{question.default}</b>
      </p>
      <div
        className="ck-picks"
        role="group"
        aria-label={`Quick answers to question ${number}, choose any`}
      >
        {quickPicks(question).map((pick) => {
          const picked = answer.picks.includes(pick);
          return (
            <button
              key={pick}
              type="button"
              className="ck-pick"
              aria-pressed={picked}
              onClick={() => onAnswer(togglePick(answer, pick))}
            >
              {picked && <CheckIcon className="ck-pick-on" />}
              {pick}
            </button>
          );
        })}
      </div>
      <AnswerBox
        className="ck-q-answer"
        rows={1}
        aria-labelledby={`${id}-q`}
        aria-describedby={`${id}-hint`}
        placeholder="Your answer (optional)"
        value={answer.text}
        onChange={(event) => onAnswer({ ...answer, text: event.target.value })}
      />
      <span id={`${id}-hint`} className="sr-only">
        Leave it empty to go with the best guess.
      </span>
    </li>
  );
}

function QuestionsBody({ approval, decide }: BodyProps) {
  const questions = approval.payload.checkpoint.questions;
  const [answers, setAnswers] = useState<QuestionAnswer[]>(() => questions.map(() => NO_ANSWER));
  const [ownWords, setOwnWords] = useState('');
  const ownId = useId();
  const reply = clarifyAnswer(questions, answers, ownWords);
  const answer = (index: number, value: QuestionAnswer) => {
    decide.hold();
    setAnswers((current) => current.map((old, at) => (at === index ? value : old)));
  };
  return (
    <form
      className="ck-questions"
      onFocus={holdOnField(decide.hold)}
      onSubmit={(event) => {
        event.preventDefault();
        if (reply && !decide.busy) decide(CHECKPOINT_OPTION.answer, reply);
      }}
    >
      <ol className="ck-q-list">
        {questions.map((question, index) => (
          <QuestionItem
            key={question.question}
            question={question}
            number={index + 1}
            answer={answers[index] ?? NO_ANSWER}
            onAnswer={(value) => answer(index, value)}
          />
        ))}
      </ol>
      {offers(approval, CHECKPOINT_OPTION.answer) && (
        <>
          <label htmlFor={ownId} className="sr-only">
            Answer in your own words
          </label>
          <AnswerBox
            id={ownId}
            className="ck-own-words"
            rows={1}
            placeholder="Answer in your own words"
            value={ownWords}
            onChange={(event) => {
              decide.hold();
              setOwnWords(event.target.value);
            }}
          />
        </>
      )}
      <div className="appr-acts ck-foot">
        <button type="submit" className="btn primary sm" disabled={decide.busy || !reply}>
          Send
        </button>
        <ClarifyFoot approval={approval} decide={decide} />
      </div>
    </form>
  );
}

export function AskedList({ approval }: { approval: CheckpointApproval }) {
  const questions = approval.payload.checkpoint.questions;
  const note = answeredNote(approval);
  const sent = sentAnswers(questions, note);
  const guessed = approval.decisionOptionId !== CHECKPOINT_OPTION.answer || note !== null;
  return (
    <ol className="ck-asked">
      {questions.map((question, index) => {
        const answer = sent.answers[index];
        return (
          <li key={question.question}>
            {question.question} {answer && <b>→ {answer}</b>}
            {!answer && guessed && <span>Best guess: {question.default}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function ChoicesBody({ approval, decide }: BodyProps) {
  const choices = approval.payload.checkpoint.choices;
  return (
    <div className="ck-own" onFocus={holdOnField(decide.hold)}>
      {choices.length > 0 && (
        <div className="appr-acts ck-choices">
          {choices.map((choice, index) => (
            <button
              key={choice}
              type="button"
              className={index === 0 ? 'btn primary sm' : 'btn line sm'}
              disabled={decide.busy}
              onClick={() => decide(clarifyOptionId(index))}
            >
              {choice}
            </button>
          ))}
        </div>
      )}
      {offers(approval, CHECKPOINT_OPTION.answer) && (
        <NoteForm
          label={choices.length > 0 ? 'Or answer in your own words' : 'Answer in your own words'}
          initial=""
          submit="Send"
          busy={decide.busy}
          onType={decide.hold}
          onSubmit={(note) => decide(CHECKPOINT_OPTION.answer, note)}
        />
      )}
      <div className="appr-acts ck-foot">
        <ClarifyFoot approval={approval} decide={decide} />
      </div>
    </div>
  );
}

export function ClarifyBody({ approval, decide }: BodyProps) {
  if (approval.payload.checkpoint.questions.length > 0) {
    return <QuestionsBody approval={approval} decide={decide} />;
  }
  return <ChoicesBody approval={approval} decide={decide} />;
}
