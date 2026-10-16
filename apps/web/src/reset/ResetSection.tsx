import { useId, useRef, useState } from 'react';
import { HoldToConfirm } from '../ui/HoldToConfirm.tsx';
import { ResetBlob } from './ResetBlob.tsx';
import { setResetState, useResetState } from './reset-store.ts';
import { useResetBlobMood } from './use-reset-blob-mood.ts';
import './reset.css';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { useSettingFocus } from '../settings/setting-focus.ts';

export const KEEP_KEYS_LABEL = 'Keep my API keys';

const REMOVED = [
  'Chats, projects, plans, tasks and tickets',
  'Your profile, settings, provider connections and the audit log',
  'Keys and tokens Spark saved in your keychain: API keys, GitHub, Linear, Jira and MCP secrets',
  'Worktree copies Spark made for agents, and their local branches that were never pushed',
];

const KEPT = [
  'Your repositories and the files in them',
  'Branches and pull requests you already pushed',
  "Other tools' MCP config files",
  'Database backups taken before upgrades',
];

export function ResetSection() {
  const state = useResetState();
  const [keepApiKeys, setKeepApiKeys] = useState(false);
  const keepHintId = useId();
  const busy = state.phase === 'counting' || state.phase === 'resetting';
  const [mood, onHoldChange] = useResetBlobMood(state.phase);
  const keepRow = useRef<HTMLDivElement>(null);
  const keepControl = useRef<HTMLLabelElement>(null);
  useSettingFocus(KEEP_KEYS_LABEL, keepRow, keepControl);

  return (
    <>
      <p className="lede">
        Start Spark Outpost over from the first onboarding step. Running agents stop first. There is
        no backup, so anything removed is gone for good.
      </p>
      <div className="reset-lists">
        <section className="reset-list" aria-labelledby="reset-removed">
          <h4 id="reset-removed">What Spark removes</h4>
          <ul>
            {REMOVED.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
        <section className="reset-list" aria-labelledby="reset-kept">
          <h4 id="reset-kept">What stays</h4>
          <ul>
            {KEPT.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>
      <div ref={keepRow} className="field reset-keep">
        <label ref={keepControl} className="check-row">
          <BlobToggle
            size="sm"
            label={KEEP_KEYS_LABEL}
            checked={keepApiKeys}
            disabled={busy}
            describedBy={keepHintId}
            onChange={setKeepApiKeys}
          />
          <span>{KEEP_KEYS_LABEL}</span>
        </label>
        <p id={keepHintId} className="set-hint">
          Claude, Codex, Z.ai and Jev keys stay in your keychain. GitHub, ticket and MCP tokens are
          still removed.
        </p>
      </div>
      <HoldToConfirm
        label="Hold to reset"
        hint={
          busy
            ? 'Spark is counting down. Press Undo to keep everything.'
            : 'Press and hold for 1.5 seconds, with the mouse or Space. You get 10 seconds to undo.'
        }
        holdingHint="Keep holding. Let go now to cancel."
        releasedHint="Released early. Nothing happened."
        disabled={busy}
        adornment={<ResetBlob mood={mood} size={42} className="reset-blob-stage" />}
        onConfirm={() => setResetState({ phase: 'counting', keepApiKeys })}
        onHoldChange={onHoldChange}
      />
    </>
  );
}
