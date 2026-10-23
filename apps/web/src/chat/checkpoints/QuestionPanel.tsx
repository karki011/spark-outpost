import { useId, type ComponentProps } from 'react';
import type { CheckpointQuestion } from '@spark-outpost/contracts';
import { CheckIcon } from '../../ui/icons.tsx';
import {
  answerText,
  quickPicks,
  takesText,
  togglePick,
  type QuestionAnswer,
} from './checkpoint-model.ts';

export const ASK_ROW = 'data-ask-row';

export function AnswerBox({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={`inp ck-box ${className ?? ''}`} rows={1} {...props} />;
}

interface OptionsProps {
  question: CheckpointQuestion;
  number: number;
  answer: QuestionAnswer;
  onAnswer(answer: QuestionAnswer): void;
}

function OptionLabel({ pick, question }: { pick: string; question: CheckpointQuestion }) {
  return (
    <>
      <span className="ask-opt-text">{pick}</span>
      {pick === question.default && <span className="ask-tag">best guess</span>}
    </>
  );
}

function CheckOptions({ question, number, answer, onAnswer }: OptionsProps) {
  return (
    <div
      className="ask-opts"
      role="group"
      aria-label={`Quick answers to question ${number}, choose any`}
    >
      {quickPicks(question).map((pick, index) => {
        const picked = answer.picks.includes(pick);
        return (
          <button
            key={pick}
            type="button"
            className="ask-opt"
            aria-pressed={picked}
            data-key={index + 1}
            {...{ [ASK_ROW]: 'option' }}
            onClick={() => onAnswer(togglePick(answer, pick, question))}
          >
            <span className="ask-box" aria-hidden="true">
              {picked && <CheckIcon className="ask-check" />}
            </span>
            <OptionLabel pick={pick} question={question} />
          </button>
        );
      })}
    </div>
  );
}

function RadioOptions({ question, number, answer, onAnswer }: OptionsProps) {
  const picks = quickPicks(question);
  const chosen = picks.findIndex((pick) => answer.picks.includes(pick));
  const tabStop = chosen === -1 ? 0 : chosen;
  return (
    <div
      className="ask-opts"
      role="radiogroup"
      aria-label={`Quick answers to question ${number}, choose one`}
    >
      {picks.map((pick, index) => (
        <button
          key={pick}
          type="button"
          role="radio"
          className="ask-opt"
          aria-checked={index === chosen}
          tabIndex={index === tabStop ? 0 : -1}
          data-key={index + 1}
          {...{ [ASK_ROW]: 'option' }}
          onClick={() => onAnswer(togglePick(answer, pick, question))}
        >
          <span className="ask-box ask-radio" aria-hidden="true" />
          <OptionLabel pick={pick} question={question} />
        </button>
      ))}
    </div>
  );
}

interface QuestionProps {
  question: CheckpointQuestion;
  number: number;
  total: number;
  answer: QuestionAnswer;
}

export function QuestionPanel({
  question,
  number,
  total,
  answer,
  onAnswer,
}: QuestionProps & { onAnswer(answer: QuestionAnswer): void }) {
  const id = useId();
  return (
    <div className="ask-q" role="group" aria-label={`Question ${number} of ${total}`}>
      <p className="ask-q-text" id={`${id}-q`}>
        {question.question}
      </p>
      {question.pick === 'one' ? (
        <RadioOptions question={question} number={number} answer={answer} onAnswer={onAnswer} />
      ) : (
        <CheckOptions question={question} number={number} answer={answer} onAnswer={onAnswer} />
      )}
      {takesText(question) && (
        <AnswerBox
          className="ask-answer"
          aria-labelledby={`${id}-q`}
          aria-describedby={`${id}-hint`}
          placeholder={quickPicks(question).length > 0 ? 'Or type your answer' : 'Type your answer'}
          value={answer.text}
          {...{ [ASK_ROW]: 'answer' }}
          onChange={(event) => onAnswer({ ...answer, text: event.target.value })}
        />
      )}
      <span id={`${id}-hint`} className="sr-only">
        {question.default ? 'Leave it empty to go with the best guess. ' : ''}Arrow keys move
        between answers, Space or a number key picks one, Enter continues.
      </span>
    </div>
  );
}

function guessLine(question: CheckpointQuestion, given: string): string {
  if (given) return `Your answer: ${given}`;
  return question.default ? `Best guess: ${question.default}` : 'Not answered yet';
}

export function QuestionLine({
  question,
  number,
  total,
  answer,
  onOpen,
}: QuestionProps & { onOpen(): void }) {
  const given = answerText(question, answer);
  return (
    <button
      type="button"
      className="ask-line"
      aria-expanded={false}
      aria-label={`Question ${number} of ${total}: ${question.question} ${guessLine(question, given)}`}
      onClick={onOpen}
    >
      <span className="ask-line-q">{question.question}</span>
      {given ? (
        <b className="ask-line-a">→ {given}</b>
      ) : (
        question.default && <span className="ask-line-a">Best guess: {question.default}</span>
      )}
    </button>
  );
}
