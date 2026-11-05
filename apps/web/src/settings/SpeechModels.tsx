import { useId, useRef, type KeyboardEvent } from 'react';
import {
  VOICE_MODELS,
  voiceModel,
  type VoiceModel,
  type VoiceStatus,
} from '@spark-outpost/contracts';
import { CloudIcon, DownloadIcon, LaptopIcon, CheckIcon, WarnIcon } from '../ui/icons.tsx';
import { desktopSpeech } from '../voice/speech-bridge.ts';
import { useSettingFocus } from './setting-focus.ts';
import { languageNote, megabytes, MODEL_CREDIT, MODEL_SUMMARIES } from '../voice/speech-models.ts';
import './speech-models.css';

export const SPEECH_MODEL_LABEL = 'Speech model';

interface RowProps {
  model: VoiceModel;
  status: VoiceStatus;
  focusable: boolean;
  onStatus(next: VoiceStatus | null): void;
}

function StatePill({ model, status }: { model: VoiceModel; status: VoiceStatus }) {
  const row = status.models[model.id];
  if (status.settings.model === model.id && row.state === 'ready')
    return (
      <span className="pill-ok">
        <CheckIcon />
        In use
      </span>
    );
  if (row.state === 'ready')
    return (
      <span className="sm-pill">
        <LaptopIcon />
        Downloaded
      </span>
    );
  if (row.state === 'downloading')
    return (
      <span className="sm-pill">
        <DownloadIcon />
        Downloading {Math.round((row.progress ?? 0) * 100)}%
      </span>
    );
  if (row.state === 'failed')
    return (
      <span className="fda-pill">
        <WarnIcon />
        {row.problem ?? 'The download didn’t check out.'}
      </span>
    );
  return (
    <span className="sm-pill">
      <CloudIcon />
      Not downloaded
    </span>
  );
}

function Action({ model, status, onStatus }: Omit<RowProps, 'focusable'>) {
  const speech = desktopSpeech()!;
  const row = status.models[model.id];
  const inUse = status.settings.model === model.id;
  const busy = VOICE_MODELS.some((each) => status.models[each.id].state === 'downloading');
  if (row.state === 'downloading')
    return (
      <button
        type="button"
        className="btn sm"
        aria-label={`Cancel ${model.name} download`}
        onClick={() => void speech.cancelDownload(model.id).then(onStatus)}
      >
        Cancel
      </button>
    );
  if (row.state === 'ready')
    return (
      <button
        type="button"
        className="btn sm"
        aria-label={`Remove ${model.name}`}
        disabled={inUse}
        title={inUse ? 'Pick another model before removing this one.' : undefined}
        onClick={() => void speech.remove(model.id).then(onStatus)}
      >
        Remove
      </button>
    );
  return (
    <button
      type="button"
      className="btn sm"
      aria-label={`Download ${model.name}, ${megabytes(model.size)}`}
      disabled={busy}
      onClick={() => void speech.download(model.id).then(onStatus)}
    >
      Download
    </button>
  );
}

function Row({ model, status, focusable, onStatus }: RowProps) {
  const speech = desktopSpeech()!;
  const nameId = useId();
  const detailId = useId();
  const row = status.models[model.id];
  const inUse = status.settings.model === model.id;
  const busy = VOICE_MODELS.some((each) => status.models[each.id].state === 'downloading');
  const choose = () => {
    if (inUse || row.state === 'downloading') return;
    if (row.state !== 'ready' && busy) return;
    void speech.select(model.id).then(onStatus);
  };
  return (
    <div className={`sm-row${inUse ? ' on' : ''}`}>
      <button
        type="button"
        role="radio"
        className="sm-choice"
        aria-checked={inUse}
        aria-labelledby={nameId}
        aria-describedby={detailId}
        tabIndex={focusable ? 0 : -1}
        data-model={model.id}
        onClick={choose}
      >
        <span className="sm-dot" aria-hidden="true" />
        <span className="sm-text">
          <span className="sm-name">
            <b id={nameId}>{model.name}</b>
            <span id={detailId} className="sm-detail">
              <StatePill model={model} status={status} />
              <span className="sm-summary">{MODEL_SUMMARIES[model.id]}</span>
            </span>
          </span>
        </span>
      </button>
      <span className="sm-size">{megabytes(model.size)}</span>
      <Action model={model} status={status} onStatus={onStatus} />
      {row.state === 'downloading' && (
        <progress
          className="sm-progress"
          max={1}
          value={row.progress ?? 0}
          aria-label={`${model.name} download`}
        />
      )}
    </div>
  );
}

function onDisk(status: VoiceStatus): number {
  return VOICE_MODELS.filter((model) => status.models[model.id].state === 'ready').reduce(
    (total, model) => total + model.size,
    0,
  );
}

function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  const steps: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
  const step = steps[event.key];
  if (step === undefined) return;
  event.preventDefault();
  const radios = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  const at = radios.indexOf(document.activeElement as HTMLButtonElement);
  radios[(at + step + radios.length) % radios.length]?.focus();
}

export function SpeechModels({
  status,
  onStatus,
}: {
  status: VoiceStatus;
  onStatus(next: VoiceStatus | null): void;
}) {
  const card = useRef<HTMLElement>(null);
  const group = useRef<HTMLDivElement>(null);
  useSettingFocus(SPEECH_MODEL_LABEL, card, group);
  const titleId = useId();
  const note = languageNote(voiceModel(status.settings.model), status.language);
  const total = onDisk(status);
  return (
    <>
      <section ref={card} className="pcard fda-card speech-models" aria-labelledby={titleId}>
        <div className="pc-head">
          <span className="nm">
            <b id={titleId}>{SPEECH_MODEL_LABEL}</b>
            <small>Used for commands and dictation</small>
          </span>
          {total > 0 && <span className="sm-disk">{megabytes(total)} on disk</span>}
        </div>
        <div ref={group} role="radiogroup" aria-labelledby={titleId} onKeyDown={moveFocus}>
          {VOICE_MODELS.map((model) => (
            <Row
              key={model.id}
              model={model}
              status={status}
              focusable={model.id === status.settings.model}
              onStatus={onStatus}
            />
          ))}
        </div>
        {note && <p className="sm-note">{note}</p>}
      </section>
      <p className="sm-credit">{MODEL_CREDIT}</p>
    </>
  );
}
