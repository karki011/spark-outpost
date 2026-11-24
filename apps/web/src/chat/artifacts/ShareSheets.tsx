import './artifact-share.css';
import { useId, useState, type ReactNode } from 'react';
import {
  ARTIFACT_SHARE_DAYS,
  ARTIFACT_SHARE_DEFAULT_DAYS,
  displayPasscode,
  type ArtifactShare,
  type ArtifactShareDays,
} from '@spark-outpost/contracts';
import { formatBytes } from '../../api/attachments.ts';
import { Switch } from '../../ui/Switch.tsx';
import { CheckIcon } from '../../ui/icons.tsx';
import { ModalFrame } from '../../ui/ModalFrame.tsx';
import { Segmented } from '../../ui/Segmented.tsx';
import { copyButtonText, useCopyFeedback } from '../../ui/use-copy-feedback.ts';

interface SheetButtonProps {
  className: string;
  busy: boolean;
  autoFocus?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function SheetButton({ className, busy, autoFocus = false, onClick, children }: SheetButtonProps) {
  return (
    <button
      type="button"
      className={className}
      data-autofocus={autoFocus || undefined}
      aria-disabled={busy}
      onClick={() => !busy && onClick()}
    >
      {children}
    </button>
  );
}

interface ConfirmSheetProps {
  title: string;
  version: number;
  bytes: number;
  busy: boolean;
  failure: string | null;
  onCancel: () => void;
  onCreate: (choice: { expiresInDays: ArtifactShareDays; passcode: boolean }) => void;
}

const DAY_OPTIONS = ARTIFACT_SHARE_DAYS.map((days) => ({
  id: String(days),
  label: days === 1 ? '1 day' : `${days} days`,
}));

export function ShareConfirmSheet(props: ConfirmSheetProps) {
  const ids = useId();
  const [passcode, setPasscode] = useState(false);
  const [days, setDays] = useState<ArtifactShareDays>(ARTIFACT_SHARE_DEFAULT_DAYS);
  return (
    <ModalFrame
      className="ashare"
      labelledBy={`${ids}title`}
      busy={props.busy}
      failure={props.failure}
      footClassName="ashare-foot"
      foot={
        <>
          <SheetButton className="btn line sm" busy={props.busy} autoFocus onClick={props.onCancel}>
            Cancel
          </SheetButton>
          <SheetButton
            className="btn primary sm"
            busy={props.busy}
            onClick={() => props.onCreate({ expiresInDays: days, passcode })}
          >
            {props.busy ? 'Creating link…' : 'Create link'}
          </SheetButton>
        </>
      }
      onClose={props.onCancel}
    >
      <h2 id={`${ids}title`}>Share “{props.title}”?</h2>
      <p className="ashare-lede">
        This uploads version {props.version} ({formatBytes(props.bytes)}) to Spark’s share service.
        Anyone with the link can open it.
      </p>
      <div className="ashare-row">
        <span className="ashare-label">
          <b>Require a passcode</b>
          <small id={`${ids}codehint`}>
            Spark makes the code. Send it separately from the link.
          </small>
        </span>
        <Switch
          label="Require a passcode"
          size="sm"
          checked={passcode}
          describedBy={`${ids}codehint`}
          disabled={props.busy}
          onChange={setPasscode}
        />
      </div>
      <div className="ashare-row">
        <b className="ashare-label">Link ends after</b>
        <Segmented
          ariaLabel="Link ends after"
          options={DAY_OPTIONS}
          value={String(days)}
          onChange={(id) => setDays(Number(id) as ArtifactShareDays)}
        />
      </div>
    </ModalFrame>
  );
}

interface CopyFieldProps {
  label: string;
  value: string;
  copyLabel: string;
  code?: boolean;
}

function CopyField({ label, value, copyLabel: idle, code = false }: CopyFieldProps) {
  const id = useId();
  const copied = useCopyFeedback();
  return (
    <div className="ashare-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className={code ? 'inp ashare-value ashare-code' : 'inp ashare-value'}
        value={value}
        readOnly
        onFocus={(event) => event.currentTarget.select()}
      />
      <button type="button" className="btn line sm" onClick={() => copied.copy(value)}>
        {copied.state === 'idle' ? idle : copyButtonText(copied.state)}
      </button>
    </div>
  );
}

interface SharedSheetProps {
  share: ArtifactShare;
  passcode: string | null;
  linkCopied: boolean;
  notice: string | null;
  canShareAgain: boolean;
  busy: boolean;
  failure: string | null;
  onStop: () => void;
  onDone: () => void;
}

function endDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'long' });
}

export function SharedSheet({
  share,
  passcode,
  linkCopied,
  notice,
  canShareAgain,
  busy,
  failure,
  onStop,
  onDone,
}: SharedSheetProps) {
  const ids = useId();
  return (
    <ModalFrame
      className="ashare"
      labelledBy={`${ids}title`}
      {...(notice ? { describedBy: `${ids}notice` } : {})}
      busy={busy}
      failure={failure}
      footClassName="ashare-foot"
      foot={
        <>
          <SheetButton className="btn sm ashare-stop" busy={busy} onClick={onStop}>
            {busy ? 'Stopping…' : 'Stop sharing'}
          </SheetButton>
          <SheetButton className="btn primary sm" busy={busy} autoFocus onClick={onDone}>
            Done
          </SheetButton>
        </>
      }
      onClose={onDone}
    >
      <h2 id={`${ids}title`} className="ashare-shared">
        <CheckIcon />
        Shared · version {share.version}
      </h2>
      {notice && (
        <p id={`${ids}notice`} className="ashare-note" role="status">
          {notice}
        </p>
      )}
      <CopyField label="Link" value={share.url} copyLabel="Copy link" />
      {linkCopied && (
        <p className="ashare-note" role="status">
          Link copied to the clipboard.
        </p>
      )}
      {passcode ? (
        <CopyField label="Passcode" value={displayPasscode(passcode)} copyLabel="Copy code" code />
      ) : (
        share.hasPasscode && (
          <p className="ashare-note">
            The passcode was shown when the link was made.
            {canShareAgain && ' To get a new one, stop sharing and share again.'}
          </p>
        )
      )}
      {!canShareAgain && (
        <p className="ashare-note">
          This build can’t make new links. After you stop sharing, this version can’t be shared
          again from here.
        </p>
      )}
      <p className="ashare-note">
        Ends {endDate(share.expiresAt)}
        {share.hasPasscode && ' · 5 wrong codes lock the link for 15 minutes'}
      </p>
    </ModalFrame>
  );
}
