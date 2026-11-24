import '../chat/project/project.css';
import './lock-code-sheet.css';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { CodeBoxes } from '../app-lock/CodeBoxes.tsx';
import { codeChangeProblem, isFullCode } from '../app-lock/lock-code.ts';
import { canRecover, useCodeRecovery } from '../app-lock/lock-recovery.ts';
import { appLock, refreshAppLock, useAppLock } from '../app-lock/use-app-lock.ts';
import { unlockCopy } from '../app-lock/unlock-copy.ts';
import { wrapTabFocus } from '../ui/focus-trap.ts';

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled)';
const FIELDS = ['current', 'next', 'again'] as const;

type Field = (typeof FIELDS)[number];

const LABELS: Record<Field, string> = {
  current: 'Current code',
  next: 'New code',
  again: 'New code again',
};

interface LockCodeSheetProps {
  change: boolean;
  onSaved: () => void;
  onClose: () => void;
}

export function LockCodeSheet({ change, onSaved, onClose }: LockCodeSheetProps) {
  const ids = useId();
  const panel = useRef<HTMLFormElement>(null);
  const inputs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});
  const [codes, setCodes] = useState<Record<Field, string>>({ current: '', next: '', again: '' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [recovered, setRecovered] = useState(false);
  const asksCurrent = change && !recovered;
  const fields = asksCurrent ? FIELDS : FIELDS.slice(1);
  const lock = appLock();
  const status = useAppLock();
  const recovery = useCodeRecovery(lock, {
    onRecovered: () => {
      setRecovered(true);
      setProblem(null);
      inputs.current.next?.focus();
    },
  });
  const offersRecovery = lock !== null && status !== null && canRecover(lock, status);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.querySelector<HTMLElement>('input')?.focus();
    return () => opener?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      wrapTabFocus(event, () => [
        ...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
      ]);
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (!busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  });

  const onCode = (field: Field, code: string) => {
    setCodes((before) => ({ ...before, [field]: code }));
    setProblem(null);
    const after = fields[fields.indexOf(field) + 1];
    if (isFullCode(code) && after) inputs.current[after]?.focus();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !lock) return;
    const mismatch = codeChangeProblem(codes.next, codes.again);
    if (mismatch) {
      setProblem(mismatch);
      return;
    }
    setBusy(true);
    try {
      const input = asksCurrent
        ? { current: codes.current, next: codes.next }
        : { next: codes.next, enable: true };
      const result = await lock.setCode(input);
      if (!result.ok) {
        setProblem(
          asksCurrent ? 'That isn’t your current code.' : 'The code didn’t save. Try again.',
        );
        return;
      }
      await refreshAppLock();
      onSaved();
    } catch {
      setProblem('The code didn’t save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const ready = fields.every((field) => isFullCode(codes[field]));

  return createPortal(
    <div
      className="fdlg-scrim over-dialog"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <form
        ref={panel}
        className="fdlg lock-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${ids}title`}
        aria-describedby={`${ids}lede`}
        onSubmit={(event) => void submit(event)}
      >
        <div className="fdlg-head">
          <h3 id={`${ids}title`}>{asksCurrent ? 'Change code' : 'Set a code'}</h3>
        </div>
        <p className="fdlg-lede" id={`${ids}lede`}>
          Six digits. You type it to unlock Spark Outpost, and it always works when{' '}
          {unlockCopy().name} doesn’t.
        </p>
        <div className="lock-sheet-fields">
          {fields.map((field) => (
            <div key={field} className="lock-sheet-field">
              <div className="lock-sheet-label">
                <label htmlFor={`${ids}${field}`}>{LABELS[field]}</label>
                {field === 'current' && offersRecovery && (
                  <button
                    type="button"
                    className="lock-sheet-forgot"
                    disabled={recovery.busy}
                    onClick={recovery.run}
                  >
                    Forgot code?
                  </button>
                )}
              </div>
              <CodeBoxes
                id={`${ids}${field}`}
                inputRef={(node) => {
                  inputs.current[field] = node;
                }}
                value={codes[field]}
                onChange={(code) => onCode(field, code)}
                invalid={problem !== null && field !== 'next'}
                describedBy={`${ids}problem`}
              />
            </div>
          ))}
        </div>
        <p id={`${ids}problem`} className="fdlg-error lock-sheet-problem" role="alert">
          {problem ?? recovery.problem}
        </p>
        <div className="fdlg-foot lock-sheet-foot">
          <button type="button" className="btn sm ghost" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn sm primary" disabled={busy || !ready}>
            {asksCurrent ? 'Change code' : 'Set code'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
