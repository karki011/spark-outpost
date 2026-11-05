import { useId, useRef, useState } from 'react';
import {
  VOICE_DEFAULT_SHORTCUT,
  type VoiceFnSetting,
  type VoiceStatus,
} from '@spark-outpost/contracts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { shortcutKeys } from '../desktop/shortcut-keys.ts';
import { CheckIcon } from '../ui/icons.tsx';
import { Keys } from '../ui/Keys.tsx';
import { desktopSpeech, useSpeechStatusState } from '../voice/speech-bridge.ts';
import { SettingRow } from './SettingRow.tsx';
import { RECORDING_HINT, ShortcutPicker, useShortcutPicker } from './ShortcutPicker.tsx';
import { SPEECH_MODEL_LABEL, SpeechModels } from './SpeechModels.tsx';
import { useSettingFocus } from './setting-focus.ts';
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
    {
      label: 'Download',
      text: 'One speech model you pick, 60 to 574 MB, once, from Hugging Face.',
    },
  ],
};

const SPEAK_INFO = {
  lead: 'Reads instant answers, Ask Spark’s replies and what an open command found with an Apple system voice.',
  items: [{ label: 'Stop', text: 'Esc or a new press stops it before the mic opens.' }],
};

const SHORTCUT_LABEL = 'Shortcut';
const SHORTCUT_TAKEN =
  'Another app is using this shortcut, so only Fn twice and the mic buttons work. Pick a different one.';
const HOLD_LABEL = 'Hold to talk';

export const VOICE_ROWS = [
  'Voice',
  SPEECH_MODEL_LABEL,
  SHORTCUT_LABEL,
  HOLD_LABEL,
  'Speak answers',
] as const;

const SHOWN_WHEN_OFF: readonly string[] = [SPEECH_MODEL_LABEL, SHORTCUT_LABEL, HOLD_LABEL];
const SHOWN_WITH_FN: readonly string[] = [HOLD_LABEL];

function hiddenRows(on: boolean, fn: boolean): readonly string[] | undefined {
  if (!on) return SHOWN_WHEN_OFF;
  return fn ? undefined : SHOWN_WITH_FN;
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

function Switch(props: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  info: typeof SPEAK_INFO;
  standsFor?: readonly string[] | undefined;
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
      standsFor={props.standsFor}
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
  const keys = shortcutKeys(status.settings.shortcut);
  const hintId = useId();
  const picker = useShortcutPicker(async (next) => (await speech.setShortcut(next))?.error ?? null);
  const problem = picker.error ?? (status.shortcutFailed ? SHORTCUT_TAKEN : null);
  const card = useRef<HTMLElement>(null);
  const choices = useRef<HTMLDivElement>(null);
  useSettingFocus(SHORTCUT_LABEL, card, choices);
  return (
    <section ref={card} className="pcard fda-card" aria-label="Voice shortcut">
      <div className="pc-head">
        <span className="nm">
          <b>{SHORTCUT_LABEL}</b>
          <small>Press to start, press again to stop</small>
        </span>
      </div>
      <div className="pc-body">
        <div ref={choices} className="voice-modes" role="radiogroup" aria-label="Voice shortcut">
          <span className="voice-mode">
            <label>
              <input
                type="radio"
                name="voice-shortcut"
                aria-label={`Use ${keys.join('')}`}
                checked={!fn}
                onChange={() => void speech.update({ shortcutMode: 'keys' }).then(onStatus)}
              />{' '}
              Use
            </label>
            <ShortcutPicker
              label="Voice shortcut"
              accelerator={status.settings.shortcut}
              isDefault={status.settings.shortcut === VOICE_DEFAULT_SHORTCUT}
              describedBy={hintId}
              picker={picker}
            />
          </span>
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
        <p id={hintId} className={problem ? 'fda-note' : 'voice-keys-hint'}>
          {problem ??
            (picker.recording ? RECORDING_HINT : 'Any modifier with a letter, number or Space.')}
        </p>
        {fn && blocked && (
          <p className="fda-note">
            macOS uses the 🌐 key for {FN_USES[status.fnSetting as Exclude<VoiceFnSetting, 'free'>]}
            , so Spark uses <Keys keys={keys} />. In Keyboard settings, set <b>Press 🌐 key to</b>{' '}
            Do Nothing and give Dictation another shortcut.{' '}
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
            Fn twice starts listening. <Keys keys={keys} /> still works.
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
    <section className="pcard fda-card" aria-label="Microphone">
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
        <p className="fda-note">
          Spoken commands are English for now; dictation follows the model.
        </p>
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
        standsFor={hiddenRows(on, status.settings.shortcutMode === 'fn')}
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
      {on && <SpeechModels status={status} onStatus={take} />}
      {on && <Setup status={status} />}
      {on && <Shortcut status={status} onStatus={take} />}
      {on && status.settings.shortcutMode === 'fn' && (
        <Switch
          label={HOLD_LABEL}
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
