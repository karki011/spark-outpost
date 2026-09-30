import { useId, useState } from 'react';
import {
  CHECKPOINT_OPTION,
  clarifyOptionId,
  type CheckpointQuestion,
} from '@spark-outpost/contracts';
import { Action, NoteForm, type Decide } from './card-parts.tsx';
import {
  clarifyAnswer,
  offers,
  optionName,
  quickPicks,
  type CheckpointApproval,
} from './checkpoint-model.ts';

interface BodyProps {
  approval: CheckpointApproval;
  decide: Decide;
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

function QuestionItem({
  question,
  number,
  answer,
  onAnswer,
}: {
  question: CheckpointQuestion;
  number: number;
  answer: string;
  onAnswer(answer: string): void;
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
      <div className="ck-picks" role="group" aria-label={`Quick answers to question ${number}`}>
        {quickPicks(question).map((pick) => (
          <button
            key={pick}
            type="button"
            className="ck-pick"
            aria-pressed={answer === pick}
            onClick={() => onAnswer(answer === pick ? '' : pick)}
          >
            {pick}
          </button>
        ))}
      </div>
      <input
        className="inp ck-q-answer"
        aria-labelledby={`${id}-q`}
        aria-describedby={`${id}-hint`}
        placeholder="Your answer (optional)"
        value={answer}
        onChange={(event) => onAnswer(event.target.value)}
      />
      <span id={`${id}-hint`} className="sr-only">
        Leave it empty to go with the best guess.
      </span>
    </li>
  );
}

function QuestionsBody({ approval, decide }: BodyProps) {
  const questions = approval.payload.checkpoint.questions;
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ''));
  const [ownWords, setOwnWords] = useState('');
  const ownId = useId();
  const reply = clarifyAnswer(questions, answers, ownWords);
  const answer = (index: number, value: string) => {
    decide.hold();
    setAnswers((current) => current.map((old, at) => (at === index ? value : old)));
  };
  return (
    <form
      className="ck-questions"
      onSubmit={(event) => {
        event.preventDefault();
        if (reply) decide(CHECKPOINT_OPTION.answer, reply);
      }}
    >
      <ol className="ck-q-list">
        {questions.map((question, index) => (
          <QuestionItem
            key={question.question}
            question={question}
            number={index + 1}
            answer={answers[index] ?? ''}
            onAnswer={(value) => answer(index, value)}
          />
        ))}
      </ol>
      {offers(approval, CHECKPOINT_OPTION.answer) && (
        <>
          <label htmlFor={ownId} className="sr-only">
            Answer in your own words
          </label>
          <textarea
            id={ownId}
            className="inp"
            rows={2}
            placeholder="Answer in your own words"
            value={ownWords}
            onChange={(event) => {
              decide.hold();
              setOwnWords(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.currentTarget.form?.requestSubmit();
              }
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

function ChoicesBody({ approval, decide }: BodyProps) {
  const choices = approval.payload.checkpoint.choices;
  return (
    <>
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
    </>
  );
}

export function ClarifyBody({ approval, decide }: BodyProps) {
  if (approval.payload.checkpoint.questions.length > 0) {
    return <QuestionsBody approval={approval} decide={decide} />;
  }
  return <ChoicesBody approval={approval} decide={decide} />;
}
