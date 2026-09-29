import type { ModelTier, ProviderId } from '@spark-outpost/contracts';
import type { BlobExpression } from '../brand/blob-expression.ts';
import { ProviderBlob } from '../brand/ProviderBlob.tsx';
import { SparkleIcon } from '../ui/icons.tsx';

const TIER_LOOK: Record<ModelTier, { size: number; expression: BlobExpression }> = {
  small: { size: 16, expression: 'sleepy' },
  mid: { size: 20, expression: 'idle' },
  top: { size: 22, expression: 'thinking' },
  frontier: { size: 22, expression: 'happy' },
};

interface ModelBlobProps {
  provider: ProviderId;
  tier: ModelTier;
  retiring: boolean;
}

export function ModelBlob({ provider, tier, retiring }: ModelBlobProps) {
  const look = TIER_LOOK[tier];
  return (
    <span className="mc-blob" aria-hidden="true">
      <ProviderBlob
        providerId={provider}
        size={look.size}
        expression={retiring ? 'sad' : look.expression}
      />
      {tier === 'frontier' && (
        <span className="mc-spark">
          <SparkleIcon />
        </span>
      )}
    </span>
  );
}
