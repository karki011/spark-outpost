import { providerIdSchema } from '@spark-outpost/contracts';
import type { BlobExpression } from './blob-expression.ts';
import { ProviderBlob } from './ProviderBlob.tsx';

interface AgentBlobProps {
  provider: string;
  size: number;
  expression?: BlobExpression;
  animate?: 'always' | 'hover';
}

export function AgentBlob({ provider, size, expression, animate }: AgentBlobProps) {
  const known = providerIdSchema.safeParse(provider);
  if (!known.success) {
    return (
      <span
        className="provider-dot"
        style={{ width: Math.round(size * 0.6), height: Math.round(size * 0.6) }}
        aria-hidden="true"
      />
    );
  }
  return (
    <ProviderBlob
      providerId={known.data}
      size={size}
      {...(expression ? { expression } : {})}
      {...(animate ? { animate } : {})}
    />
  );
}
