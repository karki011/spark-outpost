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
      <div
        className="ask-opts"
        role="group"
        aria-label={`Quick answers to question ${number}, ${
          question.pick === 'one' ? 'choose one' : 'choose any'
        }`}
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
              <span className="ask-opt-text">{pick}</span>
              {pick === question.default && <span className="ask-tag">best guess</span>}
            </button>
          );
        })}
      </div>
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
