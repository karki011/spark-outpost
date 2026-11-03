import {
  recommendedVoiceModel,
  VOICE_DEFAULT_MODEL,
  VOICE_MODELS,
  voiceModel,
  type VoiceModelId,
  type VoiceStatus,
} from '@spark-outpost/contracts';
import { DownloadIcon, LockIcon, PlusIcon } from '../ui/icons.tsx';
import { languageCount, megabytes, MODEL_SUMMARIES } from '../voice/speech-models.ts';
import '../providers/providers.css';
import './voice-step.css';

export type VoiceChoice = VoiceModelId | 'none';

export function recommendedChoice(status: VoiceStatus | null): VoiceModelId {
  if (!status) return VOICE_DEFAULT_MODEL;
  return recommendedVoiceModel(status.arch, status.language);
}

export function voiceContinueLabel(choice: VoiceChoice, status: VoiceStatus | null): string {
  if (choice === 'none' || status?.models[choice].state === 'ready') return 'Continue';
  return `Download ${megabytes(voiceModel(choice).size)} and continue`;
}

interface VoiceStepProps {
  choice: VoiceChoice;
  recommended: VoiceModelId;
  onChoose(choice: VoiceChoice): void;
}

function Option(props: {
  value: VoiceChoice;
  checked: boolean;
  onChoose(choice: VoiceChoice): void;
  name: string;
  tag?: string | undefined;
  summary: string;
  size?: string;
  languages?: string;
}) {
  return (
    <label className={`voice-opt${props.checked ? ' on' : ''}`}>
      <input
        type="radio"
        name="voice-model"
        value={props.value}
        checked={props.checked}
        onChange={() => props.onChoose(props.value)}
      />
      <span className="voice-opt-text">
        <span className="voice-opt-name">
          <b>{props.name}</b>
          {props.tag && <span className="pill-ok">{props.tag}</span>}
        </span>
        <span className="voice-opt-summary">{props.summary}</span>
      </span>
      {props.size && (
        <span className="voice-opt-size">
          <b>{props.size}</b>
          <span>{props.languages}</span>
        </span>
      )}
    </label>
  );
}

export function VoiceStep({ choice, recommended, onChoose }: VoiceStepProps) {
  return (
    <>
      <h2 id="onbTitle">Talk to Spark</h2>
      <p className="lede">
        Press <kbd>⌥⇧V</kbd>, speak, and Spark turns it into text on this Mac. Pick a speech model,
        or skip and turn Voice on later in Settings.
      </p>
      <div className="voice-opts" role="radiogroup" aria-labelledby="onbTitle">
        {VOICE_MODELS.map((model) => (
          <Option
            key={model.id}
            value={model.id}
            checked={choice === model.id}
            onChoose={onChoose}
            name={model.name}
            tag={model.id === recommended ? 'Recommended for you' : undefined}
            summary={MODEL_SUMMARIES[model.id]}
            size={megabytes(model.size)}
            languages={languageCount(model)}
          />
        ))}
        <Option
          value="none"
          checked={choice === 'none'}
          onChoose={onChoose}
          name="Not now"
          summary="Nothing downloads and the mic stays off. Settings → Voice turns it on."
        />
      </div>
      <ul className="voice-facts">
        <li>
          <LockIcon />
          Audio never leaves this Mac
        </li>
        <li>
          <DownloadIcon />
          Downloads in the background once
        </li>
        <li>
          <PlusIcon />
          Change models any time in Settings
        </li>
      </ul>
    </>
  );
}
