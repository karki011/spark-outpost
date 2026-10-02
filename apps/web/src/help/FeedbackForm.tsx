import { useCallback, useId, useRef, useState, type FormEvent } from 'react';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { exportDiagnostics, type DiagnosticsOutcome } from './export-diagnostics.ts';
import {
  draftKind,
  FEEDBACK_FIELD_MAX,
  feedbackDraft,
  fileName,
  type FeedbackDraft,
} from './feedback-draft.ts';
import { useFeedbackFocus } from './feedback-request.ts';
import { feedbackTarget } from './feedback-target.ts';

interface FeedbackFormProps {
  version: string | null;
  beta: boolean;
}

interface Result {
  text: string;
  draft: FeedbackDraft | null;
}

const SUBMIT_LABEL: Record<FeedbackDraft['kind'], string> = {
  github: 'Open GitHub issue draft',
  email: 'Open email draft',
  copy: 'Copy feedback',
};

function attachText(outcome: DiagnosticsOutcome | null): string {
  if (!outcome || outcome.kind === 'cancelled') return '';
  if (outcome.kind === 'saved') return ` Attach ${fileName(outcome.path)} from ${outcome.path}.`;
  return ` Attach ${outcome.name} from your downloads folder.`;
}

function draftText(draft: FeedbackDraft, outcome: DiagnosticsOutcome | null): string {
  const attach = attachText(outcome);
  if (draft.kind === 'github') {
    return `A GitHub issue draft opened in your browser.${attach} Nothing is sent until you submit it.`;
  }
  if (draft.kind === 'email') {
    return `A draft opened in your email app.${attach} Nothing is sent until you send it.`;
  }
  return `Copied your feedback. Paste it into a message to the Spark Outpost team.${attach}`;
}

async function deliver(draft: FeedbackDraft): Promise<void> {
  if (draft.kind === 'copy') {
    await navigator.clipboard.writeText(draft.body);
    return;
  }
  window.open(draft.url, '_blank', 'noopener');
}

export function FeedbackForm({ version, beta }: FeedbackFormProps) {
  const happenedId = useId();
  const expectedId = useId();
  const diagnosticsHint = useId();
  const resultId = useId();
  const happenedRef = useRef<HTMLTextAreaElement>(null);
  const [happened, setHappened] = useState('');
  const [expected, setExpected] = useState('');
  const [withDiagnostics, setWithDiagnostics] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const target = feedbackTarget();
  const kind = draftKind(target);

  useFeedbackFocus(useCallback(() => happenedRef.current?.focus(), []));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (happened.trim() === '') {
      happenedRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const outcome = withDiagnostics ? await exportDiagnostics() : null;
      if (outcome?.kind === 'cancelled') {
        setResult({ text: 'Diagnostics were not saved, so no draft opened.', draft: null });
        return;
      }
      const attached = outcome?.kind === 'saved' ? fileName(outcome.path) : (outcome?.name ?? null);
      const draft = feedbackDraft(target, {
        happened,
        expected,
        version,
        beta,
        diagnostics: attached,
      });
      await deliver(draft);
      setResult({ text: draftText(draft, outcome), draft });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Something went wrong.';
      setResult({ text: `No draft opened. ${reason}`, draft: null });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="help-feedback" aria-labelledby={`${happenedId}-title`} onSubmit={submit}>
      <h4 id={`${happenedId}-title`}>Send feedback</h4>
      <p className="set-hint">
        Spark writes a draft for you to check and send yourself. Nothing is sent automatically.
      </p>
      <label className="field" htmlFor={happenedId}>
        <span>What happened?</span>
        <textarea
          ref={happenedRef}
          id={happenedId}
          className="inp help-text"
          rows={4}
          maxLength={FEEDBACK_FIELD_MAX}
          required
          value={happened}
          onChange={(event) => setHappened(event.target.value)}
          placeholder="I clicked Ship and the button stayed busy…"
        />
      </label>
      <label className="field" htmlFor={expectedId}>
        <span>What did you expect?</span>
        <textarea
          id={expectedId}
          className="inp help-text"
          rows={3}
          maxLength={FEEDBACK_FIELD_MAX}
          value={expected}
          onChange={(event) => setExpected(event.target.value)}
        />
      </label>
      <div className="field">
        <label className="check-row">
          <BlobToggle
            size="sm"
            label="Include diagnostics"
            checked={withDiagnostics}
            disabled={busy}
            describedBy={diagnosticsHint}
            onChange={setWithDiagnostics}
          />
          <span>Include diagnostics</span>
        </label>
        <p id={diagnosticsHint} className="set-hint">
          Spark saves the diagnostics zip first and tells you where it is, so you can attach it.
        </p>
      </div>
      <div className="help-actions">
        <button
          type="submit"
          className="btn primary sm"
          disabled={busy}
          aria-describedby={resultId}
        >
          {busy ? 'Preparing…' : SUBMIT_LABEL[kind]}
        </button>
        {result?.draft && result.draft.kind !== 'copy' && (
          <a className="btn ghost sm" href={result.draft.url} target="_blank" rel="noreferrer">
            Open the draft again
          </a>
        )}
      </div>
      <p id={resultId} className="set-hint help-result" aria-live="polite">
        {result?.text ?? ''}
      </p>
    </form>
  );
}
