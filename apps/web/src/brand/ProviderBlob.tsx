import { Blobatar } from 'blobatar/react';
import * as expressions from 'blobatar/expression';
import type { ConnectableId } from '@spark-outpost/contracts';
import type { BlobExpression } from './blob-expression.ts';

const PROVIDER_SEED: Record<ConnectableId, { name: string; hue: number }> = {
  claude: { name: 'claude', hue: 24 },
  codex: { name: 'codex-outpost', hue: 205 },
  zai: { name: 'zai-glm', hue: 112 },
  jev: { name: 'jev-typesafe', hue: 318 },
};

interface ProviderBlobProps {
  providerId: ConnectableId;
  size?: number;
  expression?: BlobExpression;
  animate?: 'always' | 'hover';
}

export function ProviderBlob({
  providerId,
  size = 42,
  expression = 'idle',
  animate = 'hover',
}: ProviderBlobProps) {
  const seed = PROVIDER_SEED[providerId];
  return (
    <Blobatar
      name={seed.name}
      hue={seed.hue}
      size={size}
      animate={animate}
      expression={expressions[expression]}
      aria-hidden="true"
    />
  );
}
