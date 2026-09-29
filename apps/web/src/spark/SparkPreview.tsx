import { firstName, type Personality } from '@spark-outpost/contracts';
import { BlobScout } from '../brand/BlobScout.tsx';
import { hello, sparkMood } from './voice.ts';

interface SparkPreviewProps {
  displayName: string;
  personality: Personality;
  enabled: boolean;
  size?: number;
}

export function SparkPreview({ displayName, personality, enabled, size = 44 }: SparkPreviewProps) {
  const line = enabled
    ? hello({ personality, name: firstName(displayName) })
    : 'Spark is napping. Chats go straight to your agent.';
  return (
    <div className="spark-preview" data-enabled={enabled || undefined}>
      <BlobScout size={size} mood={sparkMood(personality, enabled)} />
      <p className="spark-bubble" aria-live="polite">
        {line}
      </p>
    </div>
  );
}
