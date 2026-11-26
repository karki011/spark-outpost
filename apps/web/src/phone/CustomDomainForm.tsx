import { useId, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { RemoteAccess } from '@spark-outpost/contracts';
import { CopyIcon } from '../ui/icons.tsx';
import { copyButtonText, useCopyFeedback } from '../ui/use-copy-feedback.ts';
import { ConfirmCheck, WarningNote } from '../ui/WarningNote.tsx';
import {
  CONFIRM_LABEL,
  DOMAIN_LABEL,
  DOMAIN_PLACEHOLDER,
  FORWARD_LABEL,
  FORWARD_NOTE,
  FORWARD_UNKNOWN,
  REPLACES_TAILSCALE,
  TURN_ON,
  WARNING_LEAD,
  WARNING_TEXT,
  parseCustomDomain,
} from './custom-domain.ts';
import { phoneApi } from './phone-api.ts';

interface CustomDomainFormProps {
  forwardTo: string | null;
  replacesTailscale: boolean;
  onSaved: (access: RemoteAccess) => void;
}

function ForwardTo({ forwardTo }: { forwardTo: string | null }) {
  const { state: copied, copy } = useCopyFeedback();
  const labelId = useId();
  return (
    <div className="ph-forward" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="ph-field-label">
        {FORWARD_LABEL}
      </span>
      {forwardTo ? (
        <div className="ph-forward-row">
          <code>{forwardTo}</code>
          <button type="button" className="btn line sm" onClick={() => copy(forwardTo)}>
            <CopyIcon />
            <span aria-live="polite">{copyButtonText(copied)}</span>
          </button>
        </div>
      ) : (
        <p className="ph-note">{FORWARD_UNKNOWN}</p>
      )}
      <p className="ph-note">{FORWARD_NOTE}</p>
    </div>
  );
}

export function CustomDomainForm({ forwardTo, replacesTailscale, onSaved }: CustomDomainFormProps) {
  const ids = useId();
  const [domain, setDomain] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [tried, setTried] = useState(false);
  const parsed = parseCustomDomain(domain);
  const problem = !parsed.ok && (domain.trim() !== '' || tried) ? parsed.problem : null;
  const save = useMutation({
    mutationFn: (hostname: string) => phoneApi.setAccess({ hostname, confirmed: true }),
    onSuccess: onSaved,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (parsed.ok && confirmed && !save.isPending) save.mutate(parsed.hostname);
  };
  return (
    <form className="ph-card ph-custom" noValidate onSubmit={submit}>
      <div className="field">
        <label htmlFor={`${ids}-domain`} className="ph-field-label">
          {DOMAIN_LABEL}
        </label>
        <input
          id={`${ids}-domain`}
          className="inp"
          placeholder={DOMAIN_PLACEHOLDER}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={domain}
          maxLength={400}
          aria-invalid={problem !== null}
          aria-describedby={problem ? `${ids}-problem` : undefined}
          onChange={(event) => setDomain(event.target.value)}
        />
        {problem && (
          <p id={`${ids}-problem`} className="ph-error">
            {problem}
          </p>
        )}
      </div>
      <ForwardTo forwardTo={forwardTo} />
      <WarningNote id={`${ids}-warning`} lead={WARNING_LEAD}>
        {WARNING_TEXT}
      </WarningNote>
      <ConfirmCheck
        label={CONFIRM_LABEL}
        checked={confirmed}
        describedBy={`${ids}-warning`}
        onChange={setConfirmed}
      />
      {replacesTailscale && <p className="ph-note">{REPLACES_TAILSCALE}</p>}
      <div className="ph-custom-actions">
        <button type="submit" className="btn primary sm" disabled={!confirmed || save.isPending}>
          {save.isPending ? 'Turning on…' : TURN_ON}
        </button>
      </div>
      {save.error && (
        <p className="ph-error" role="alert">
          {save.error.message}
        </p>
      )}
    </form>
  );
}
