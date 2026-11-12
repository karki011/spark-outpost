import { useId, useRef } from 'react';
import { VOICE_MODELS, type VoiceModel, type VoiceStatus } from '@spark-outpost/contracts';
import { CloudIcon, DownloadIcon, CheckIcon, WarnIcon } from '../ui/icons.tsx';
import { desktopSpeech } from '../voice/speech-bridge.ts';
import { useSettingFocus } from './setting-focus.ts';
import { languageNote, megabytes, MODEL_CREDIT, MODEL_SUMMARY } from '../voice/speech-models.ts';
import './speech-models.css';

export const SPEECH_MODEL_LABEL = 'Speech model';

interface RowProps {
  model: VoiceModel;
  status: VoiceStatus;
  onStatus(next: VoiceStatus | null): void;
}

function StatePill({ model, status }: Pick<RowProps, 'model' | 'status'>) {
  const row = status.models[model.id];
  if (row.state === 'ready')
    return (
      <span className="pill-ok">
        <CheckIcon />
        Ready
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

function Action({ model, status, onStatus }: RowProps) {
  const speech = desktopSpeech()!;
  const row = status.models[model.id];
  if (row.state === 'ready') return null;
  if (row.state === 'downloading')
    return (
      <button
        type="button"
        className="btn sm"
        aria-label={`Cancel ${model.name} download`}
        onClick={() => void speech.cancelDownload().then(onStatus)}
      >
        Cancel
      </button>
    );
  return (
    <button
      type="button"
      className="btn sm"
      aria-label={`Download ${model.name}, ${megabytes(model.size)}`}
      onClick={() => void speech.download().then(onStatus)}
    >
      Download
    </button>
  );
}

function Row({ model, status, onStatus }: RowProps) {
  const nameId = useId();
  const row = status.models[model.id];
  return (
    <div className="sm-row">
      <span className="sm-text">
        <span className="sm-name">
          <b id={nameId}>{model.name}</b>
          <StatePill model={model} status={status} />
          <span className="sm-summary">{MODEL_SUMMARY}</span>
        </span>
      </span>
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

export function SpeechModels({
  status,
  onStatus,
}: {
  status: VoiceStatus;
  onStatus(next: VoiceStatus | null): void;
}) {
  const card = useRef<HTMLElement>(null);
  const titleId = useId();
  useSettingFocus(SPEECH_MODEL_LABEL, card, card);
  const model = VOICE_MODELS[0]!;
  const note = languageNote(model, status.language);
  return (
    <>
      <section ref={card} className="pcard fda-card speech-models" aria-labelledby={titleId}>
        <div className="pc-head">
          <span className="nm">
            <b id={titleId}>{SPEECH_MODEL_LABEL}</b>
            <small>Used for commands and dictation</small>
          </span>
        </div>
        <Row model={model} status={status} onStatus={onStatus} />
        {note && <p className="sm-note">{note}</p>}
      </section>
      <p className="sm-credit">{MODEL_CREDIT}</p>
    </>
  );
}
