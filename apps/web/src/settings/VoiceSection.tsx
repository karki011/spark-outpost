import { useId, useState } from 'react';
import type { VoiceFnSetting, VoiceStatus } from '@spark-outpost/contracts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { CheckIcon } from '../ui/icons.tsx';
import { desktopSpeech, useSpeechStatusState } from '../voice/speech-bridge.ts';
import { SettingRow } from './SettingRow.tsx';
import '../providers/providers.css';
import './full-disk-access.css';
import './mac-control.css';

const FN_USES: Record<Exclude<VoiceFnSetting, 'free'>, string> = {
  emoji: 'Show Emoji & Symbols',
  input_source: 'Change Input Source',
  dictation: 'Dictation',
};

const VOICE_INFO = {
  lead: 'Push to talk: press the shortcut or a mic button, speak, and Spark turns it into text on this Mac.',
  items: [
    {
      label: 'Never',
      text: 'Always listening, a wake word, or starting work without your confirm.',
    },
    {
      label: 'Stays on the Mac',
      text: 'Audio and spoken answers. Text leaves only when you send it.',
    },
    { label: 'Download', text: 'A 60 MB speech model, once, from Hugging Face.' },
  ],
};

const SPEAK_INFO = {
  lead: 'Reads instant answers, Ask Spark’s replies and what an open command found with an Apple system voice.',
  items: [{ label: 'Stop', text: 'Esc or a new press stops it before the mic opens.' }],
};

export function voiceAvailable(): boolean {
  return desktopSpeech() !== null;
}

function Pill({ ok, text }: { ok: boolean; text: string }) {
  if (!ok) return <span className="fda-pill">{text}</span>;
  return (
    <span className="pill-ok">
      <CheckIcon />
      {text}
    </span>
  );
}

function modelLine(status: VoiceStatus): string {
  if (status.model === 'ready') return 'Ready';
  if (status.model === 'downloading')
    return `Downloading… ${Math.round((status.progress ?? 0) * 100)}%`;
  if (status.model === 'failed') return status.problem ?? 'The download didn’t check out.';
  return 'Downloads when you turn Voice on';
}

function Switch(props: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  info: typeof SPEAK_INFO;
  onChange: (on: boolean) => void;
}) {
  const id = useId();
  const hintId = useId();
  return (
    <SettingRow
      label={props.label}
      controlId={id}
      info={props.info}
      hint={props.hint}
      hintId={hintId}
    >
      <BlobToggle
        kind="plain"
        id={id}
        label={props.label}
        checked={props.checked}
        disabled={props.disabled ?? false}
        describedBy={hintId}
        onChange={props.onChange}
      />
    </SettingRow>
  );
}

function Shortcut({
  status,
  onStatus,
}: {
  status: VoiceStatus;
  onStatus: (next: VoiceStatus | null) => void;
}) {
  const speech = desktopSpeech()!;
  const fn = status.settings.shortcutMode === 'fn';
  const blocked = status.fnSetting !== 'free';
  return (
    <section className="pcard fda-card" aria-label="Voice shortcut">
      <div className="pc-head">
        <span className="nm">
          <b>Shortcut</b>
          <small>Press to start, press again to stop</small>
        </span>
      </div>
      <div className="pc-body">
        <div className="mac-actions" role="radiogroup" aria-label="Voice shortcut">
          <label>
            <input
              type="radio"
              name="voice-shortcut"
              checked={!fn}
              onChange={() => void speech.update({ shortcutMode: 'keys' }).then(onStatus)}
            />{' '}
            Use <kbd>⌥⇧V</kbd>
          </label>
          <label>
            <input
              type="radio"
              name="voice-shortcut"
              checked={fn}
              onChange={() => void speech.update({ shortcutMode: 'fn' }).then(onStatus)}
            />{' '}
            Use Fn twice
          </label>
        </div>
        {fn && blocked && (
          <p className="fda-note">
            macOS uses the 🌐 key for {FN_USES[status.fnSetting as Exclude<VoiceFnSetting, 'free'>]}
            , so Spark uses <kbd>⌥⇧V</kbd>. In Keyboard settings, set <b>Press 🌐 key to</b> Do
            Nothing and give Dictation another shortcut.{' '}
            <button
              type="button"
              className="btn sm"
              onClick={() => void speech.openSettings('keyboard')}
            >
              Open Keyboard settings
            </button>
          </p>
        )}
        {fn && !blocked && !status.inputMonitoring && (
          <p className="fda-note">
            Fn twice needs Input Monitoring for Spark Outpost.{' '}
            <button
              type="button"
              className="btn sm"
              onClick={() => void speech.openSettings('input-monitoring')}
            >
              Open Input Monitoring settings
            </button>
          </p>
        )}
        {fn && status.fnActive && (
          <p>
            Fn twice starts listening. <kbd>⌥⇧V</kbd> still works.
          </p>
        )}
        {status.shortcutFailed && (
          <p className="fda-note">
            Another app is using ⌥⇧V, so only Fn twice and the mic buttons work.
          </p>
        )}
      </div>
    </section>
  );
}

function Setup({ status }: { status: VoiceStatus }) {
  const speech = desktopSpeech()!;
  const micOk = status.mic === 'granted';
  return (
    <section className="pcard fda-card" aria-label="Microphone and speech model">
      <div className="pc-head">
        <span className="nm">
          <b>Microphone</b>
          <small>macOS permission for Spark Outpost</small>
        </span>
        <Pill ok={micOk} text={micOk ? 'Allowed' : 'Not yet'} />
      </div>
      <div className="pc-body">
        {!micOk && (
          <div className="mac-actions">
            <button
              type="button"
              className="btn sm"
              onClick={() => void speech.openSettings('microphone')}
            >
              Open Microphone settings
            </button>
          </div>
        )}
        <dl className="fda-facts">
          <div>
            <dt>Speech model</dt>
            <dd role="status">{modelLine(status)}</dd>
          </div>
          <div>
            <dt>Language</dt>
            <dd>{status.language}, your Mac’s language. Commands are English for now.</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

export function VoiceSection() {
  const [status, setStatus] = useSpeechStatusState();
  const [busy, setBusy] = useState(false);
  const speech = desktopSpeech();
  if (!speech || !status) return null;
  const take = (next: VoiceStatus | null) => {
    if (next) setStatus(next);
  };
  const missing = status.helper !== 'ready';
  const on = status.settings.enabled;
  const toggle = async (next: boolean) => {
    setBusy(true);
    take(await (next ? speech.turnOn() : speech.turnOff()));
    setBusy(false);
  };
  return (
    <div className="mac-control">
      <Switch
        label="Voice"
        info={VOICE_INFO}
        checked={on}
        disabled={busy || missing}
        hint={
          missing
            ? 'This build has no voice helper. From source, run pnpm desktop:voice.'
            : on
              ? 'On. Press the shortcut or a mic button to talk; nothing starts until you confirm.'
              : 'Off. Spark never listens.'
        }
        onChange={(next) => void toggle(next)}
      />
      {on && <Setup status={status} />}
      {on && <Shortcut status={status} onStatus={take} />}
      {on && status.settings.shortcutMode === 'fn' && (
        <Switch
          label="Hold to talk"
          info={{
            lead: 'Listen while the second Fn press is held, and stop when you let go.',
            items: [],
          }}
          checked={status.settings.hold}
          hint={
            status.settings.hold
              ? 'Hold Fn after the second press.'
              : 'Off. Press to start and to stop.'
          }
          onChange={(next) => void speech.update({ hold: next }).then(take)}
        />
      )}
      <Switch
        label="Speak answers"
        info={SPEAK_INFO}
        checked={status.settings.speakAnswers}
        disabled={!on}
        hint={
          status.settings.speakAnswers
            ? 'Answers are read aloud. Off while VoiceOver runs.'
            : 'Off. Answers are only shown.'
        }
        onChange={(next) => void speech.update({ speakAnswers: next }).then(take)}
      />
    </div>
  );
}
