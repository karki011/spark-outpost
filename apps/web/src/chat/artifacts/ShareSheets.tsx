import './artifact-share.css';
import { useId, useState, type ReactNode } from 'react';
import {
  ARTIFACT_SHARE_DEFAULT_DAYS,
  displayPasscode,
  type ArtifactShare,
  type ArtifactShareDays,
  type ArtifactShareService,
} from '@spark-outpost/contracts';
import { formatBytes } from '../../api/attachments.ts';
import { ChoicePicker } from '../../ui/ChoicePicker.tsx';
import { Switch } from '../../ui/Switch.tsx';
import { CheckIcon } from '../../ui/icons.tsx';
import { ModalFrame } from '../../ui/ModalFrame.tsx';
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
  service: ArtifactShareService | null;
  host: string | null;
  days: readonly number[];
  busy: boolean;
  failure: string | null;
  onCancel: () => void;
  onConnect: () => void;
  onCreate: (choice: { expiresInDays: ArtifactShareDays; passcode: boolean }) => void;
}

function dayCount(days: number): string {
  return days === 1 ? '1 day' : `${days} days`;
}

function firstChoice(days: readonly number[]): number {
  if (days.includes(ARTIFACT_SHARE_DEFAULT_DAYS)) return ARTIFACT_SHARE_DEFAULT_DAYS;
  return days.at(-1) ?? ARTIFACT_SHARE_DEFAULT_DAYS;
}

export const HOSTED_LIMIT_LINE =
  'Links from Spark’s shared service last 1 day. Connect your own Cloudflare account for 7 days.';

export function ShareConfirmSheet(props: ConfirmSheetProps) {
  const ids = useId();
  const [passcode, setPasscode] = useState(false);
  const [chosen, setDays] = useState(() => firstChoice(props.days));
  const days = props.days.includes(chosen) ? chosen : firstChoice(props.days);
  const own = props.service === 'own';
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
            onClick={() => props.onCreate({ expiresInDays: days as ArtifactShareDays, passcode })}
          >
            {props.busy ? 'Creating link…' : 'Create link'}
          </SheetButton>
        </>
      }
      onClose={props.onCancel}
    >
      <h2 id={`${ids}title`}>Share “{props.title}”?</h2>
      <p className="ashare-lede">
        This uploads version {props.version} ({formatBytes(props.bytes)}). Anyone with the link can
        open it.
      </p>
      <div className="ashare-row">
        <b className="ashare-label">Shared from</b>
        <span className="ashare-label ashare-from">
          <b>{own ? 'Your Cloudflare account' : 'Spark’s shared service'}</b>
          {own && props.host && <small>{props.host}</small>}
        </span>
      </div>
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
      {props.days.length > 1 ? (
        <div className="ashare-row">
          <b className="ashare-label">Link ends after</b>
          <ChoicePicker
            label="Link ends after"
            choices={props.days.map((count) => ({ id: String(count), label: dayCount(count) }))}
            value={String(days)}
            onChange={(id) => setDays(Number(id))}
          />
        </div>
      ) : (
        <p className="ashare-row ashare-ends">Expires in {dayCount(days)}</p>
      )}
      {!own && (
        <div className="ashare-row ashare-upsell">
          <p className="ashare-note">{HOSTED_LIMIT_LINE}</p>
          <SheetButton className="btn line sm" busy={props.busy} onClick={props.onConnect}>
            Connect Cloudflare
          </SheetButton>
        </div>
      )}
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
          Spark can’t make new links now. After you stop sharing, connect Cloudflare to share this
          version again.
        </p>
      )}
      <p className="ashare-note">
        Ends {endDate(share.expiresAt)}
        {share.hasPasscode && ' · 5 wrong codes lock the link for 15 minutes'}
      </p>
    </ModalFrame>
  );
}

interface ConnectSheetProps {
  onCancel: () => void;
  onConnect: () => void;
}

export function ShareConnectSheet({ onCancel, onConnect }: ConnectSheetProps) {
  const ids = useId();
  return (
    <ModalFrame
      className="ashare"
      labelledBy={`${ids}title`}
      describedBy={`${ids}text`}
      footClassName="ashare-foot"
      foot={
        <>
          <button type="button" className="btn line sm" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn primary sm" data-autofocus onClick={onConnect}>
            Connect Cloudflare
          </button>
        </>
      }
      onClose={onCancel}
    >
      <h2 id={`${ids}title`}>Connect Cloudflare to share artifacts</h2>
      <p id={`${ids}text`} className="ashare-lede">
        Shared pages are stored in your own Cloudflare account and served from your address. Set it
        up in Settings → Connectors.
      </p>
    </ModalFrame>
  );
}
