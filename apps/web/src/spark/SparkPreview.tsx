import { firstName, type Personality } from '@spark-outpost/contracts';
import { BlobScout } from '../brand/BlobScout.tsx';
import { hello, sparkMood } from './voice.ts';

interface SparkPreviewProps {
  displayName: string;
  personality: Personality;
  size?: number;
}

export function SparkPreview({ displayName, personality, size = 44 }: SparkPreviewProps) {
  const line = hello({ personality, name: firstName(displayName) });
  return (
    <div className="spark-preview">
      <BlobScout size={size} mood={sparkMood(personality)} />
      <p className="spark-bubble" aria-live="polite">
        {line}
      </p>
    </div>
  );
}
