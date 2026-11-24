import type { ModelTier, ProviderId } from '@spark-outpost/contracts';
import { ProviderMark } from '../brand/ProviderMark.tsx';
import { SparkleIcon } from '../ui/icons.tsx';

const TIER_SIZE: Record<ModelTier, number> = { small: 16, mid: 20, top: 22, frontier: 22 };

interface ModelBlobProps {
  provider: ProviderId;
  tier: ModelTier;
}

export function ModelBlob({ provider, tier }: ModelBlobProps) {
  return (
    <span className="mc-blob" aria-hidden="true">
      <ProviderMark providerId={provider} size={TIER_SIZE[tier]} />
      {tier === 'frontier' && (
        <span className="mc-spark">
          <SparkleIcon />
        </span>
      )}
    </span>
  );
}
