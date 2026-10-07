import { CHECKPOINT_OPTION, clarifyOptionId } from '@spark-outpost/contracts';
import { NoteForm, type Decide } from './card-parts.tsx';
import { ClarifyFoot, holdOnField } from './clarify-parts.tsx';
import { answeredNote, offers, sentAnswers, type CheckpointApproval } from './checkpoint-model.ts';
import { QuestionsBody } from './QuestionsBody.tsx';

interface BodyProps {
  approval: CheckpointApproval;
  decide: Decide;
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
