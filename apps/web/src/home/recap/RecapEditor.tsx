import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  RECAP_REFINE_TEXT_MAX_LENGTH,
  type RecapBody,
  type RecapRefine,
  type RecapVoice,
} from '@spark-outpost/contracts';
import { copyButtonText, useCopyFeedback } from '../../ui/use-copy-feedback.ts';
import { copyText, latestRefined, plainText } from './recap-model.ts';

interface RecapEditorProps {
  body: RecapBody;
  voice: RecapVoice;
  refines: readonly RecapRefine[];
  rewriting: boolean;
  refineError: string | null;
  onRefine: (voice: RecapVoice, text: string, instruction: string) => void;
}

type Drafts = Partial<Record<RecapVoice, string[]>>;

function startText(body: RecapBody, refines: readonly RecapRefine[], voice: RecapVoice) {
  return latestRefined(refines, voice) ?? copyText(body, voice);
}

export function RecapEditor(props: RecapEditorProps) {
  const { body, voice, refines, rewriting, refineError, onRefine } = props;
  const [drafts, setDrafts] = useState<Drafts>({});
  const [instruction, setInstruction] = useState('');
  const markdown = useCopyFeedback();
  const plain = useCopyFeedback();
  const boxId = useId();
  const seen = useRef(new Set(refines.map((refine) => refine.id)));

  useEffect(() => {
    for (const refine of refines) {
      if (seen.current.has(refine.id) || refine.status !== 'ready' || !refine.textOut) continue;
      seen.current.add(refine.id);
      const text = refine.textOut;
      setDrafts((current) => {
        const history = current[refine.voice] ?? [refine.textIn];
        return { ...current, [refine.voice]: [...history, text] };
      });
    }
  }, [refines]);

  const history = drafts[voice] ?? [startText(body, refines, voice)];
  const text = history.at(-1) ?? '';
  const setText = (next: string) =>
    setDrafts((current) => ({ ...current, [voice]: [...history.slice(0, -1), next] }));
  const undo = () => setDrafts((current) => ({ ...current, [voice]: history.slice(0, -1) }));

  const tooLong = text.trim().length > RECAP_REFINE_TEXT_MAX_LENGTH;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const ask = instruction.trim();
    if (!ask || !text.trim() || tooLong || rewriting) return;
    onRefine(voice, text, ask);
    setInstruction('');
  };

  return (
    <div className="recap-edit">
      <label className="recap-label" htmlFor={boxId}>
        {voice === 'manager' ? 'Message for your manager' : 'Your note'}
      </label>
      <textarea
        id={boxId}
        className="inp recap-box"
        rows={5}
        value={text}
        aria-busy={rewriting}
        readOnly={rewriting}
        onChange={(event) => setText(event.target.value)}
      />
      <form className="recap-refine" onSubmit={submit}>
        <input
          className="inp"
          aria-label="Ask Spark to change the message"
          placeholder={
            rewriting ? 'Rewriting…' : 'Ask for a change, like “shorter” or “less technical”'
          }
          value={instruction}
          disabled={rewriting}
          maxLength={500}
          onChange={(event) => setInstruction(event.target.value)}
        />
        <button
          type="submit"
          className="btn sm line"
          disabled={rewriting || tooLong || !instruction.trim()}
        >
          {rewriting ? 'Rewriting…' : 'Refine'}
        </button>
      </form>
      {tooLong && (
        <p className="home-error" role="alert">
          Refine works on up to {RECAP_REFINE_TEXT_MAX_LENGTH.toLocaleString()} characters. Shorten
          the message first.
        </p>
      )}
      {refineError && (
        <p className="home-error" role="alert">
          {refineError}
        </p>
      )}
      <div className="recap-actions">
        <button type="button" className="btn primary sm" onClick={() => markdown.copy(text)}>
          {copyButtonText(markdown.state)}
        </button>
        <button type="button" className="btn sm line" onClick={() => plain.copy(plainText(text))}>
          {plain.state === 'idle' ? 'Copy as plain text' : copyButtonText(plain.state)}
        </button>
        {history.length > 1 && (
          <button type="button" className="btn sm line" onClick={undo}>
            Undo
          </button>
        )}
      </div>
    </div>
  );
}
