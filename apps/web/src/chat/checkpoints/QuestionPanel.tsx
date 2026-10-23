import { useId, type ComponentProps } from 'react';
import type { CheckpointQuestion } from '@spark-outpost/contracts';
import {
  answerText,
  choosePick,
  quickPicks,
  takesText,
  togglePick,
  typeAnswer,
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

interface PanelProps extends QuestionProps {
  guessLabel: string;
  titled: boolean;
  onAnswer(answer: QuestionAnswer): void;
}

function OptionRows({
  question,
  answer,
  guessLabel,
  onAnswer,
  name,
}: PanelProps & { name: string }) {
  const single = question.pick === 'one';
  return quickPicks(question).map((pick, index) => {
    const picked = answer.picks.includes(pick);
    return (
      <label key={pick} className={picked ? 'ask-opt picked' : 'ask-opt'}>
        <input
          type={single ? 'radio' : 'checkbox'}
          name={single ? name : undefined}
          className="ask-input"
          checked={picked}
          {...{ [ASK_ROW]: single ? 'radio' : 'option' }}
          onChange={() => onAnswer(single ? choosePick(pick) : togglePick(answer, pick, question))}
        />
        <span className="ask-opt-text">{pick}</span>
        {pick === question.default && <span className="ask-tag">{guessLabel}</span>}
        <kbd className="ask-key" aria-hidden="true">
          {index + 1}
        </kbd>
      </label>
    );
  });
}

function placeholder(question: CheckpointQuestion): string {
  return quickPicks(question).length > 0 ? 'Something else…' : 'Type your answer';
}

export function QuestionPanel(props: PanelProps) {
  const { question, number, total, answer, titled, onAnswer } = props;
  const id = useId();
  const single = question.pick === 'one';
  return (
    <div className="ask-q" role="group" aria-label={`Question ${number} of ${total}`}>
      {!titled && (
        <p className="ask-q-text">
          <span>{question.question}</span>
          {total > 1 && (
            <span className="ask-count" aria-hidden="true">
              {number} of {total}
            </span>
          )}
        </p>
      )}
      <div
        className="ask-opts"
        role={single ? 'radiogroup' : 'group'}
        aria-label={`${question.question}, ${single ? 'choose one' : 'choose any'}`}
      >
        <OptionRows {...props} name={id} />
      </div>
      {takesText(question) && (
        <AnswerBox
          className="ask-answer"
          aria-label={`${question.question}: ${placeholder(question)}`}
          aria-describedby={`${id}-hint`}
          placeholder={placeholder(question)}
          value={answer.text}
          {...{ [ASK_ROW]: 'answer' }}
          onChange={(event) => onAnswer(typeAnswer(answer, event.target.value, question))}
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
