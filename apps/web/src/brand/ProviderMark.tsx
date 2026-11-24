import { providerIdSchema, type ConnectableId } from '@spark-outpost/contracts';
import { MarkTile } from './MarkTile.tsx';

const PROVIDER_MARK: Record<ConnectableId, { letters: string; hue: number }> = {
  claude: { letters: 'C', hue: 45 },
  codex: { letters: 'X', hue: 240 },
  zai: { letters: 'Z', hue: 145 },
  custom: { letters: 'E', hue: 300 },
  jev: { letters: 'J', hue: 340 },
};

interface ProviderMarkProps {
  providerId: ConnectableId;
  size?: number;
}

export function ProviderMark({ providerId, size = 28 }: ProviderMarkProps) {
  const mark = PROVIDER_MARK[providerId];
  return <MarkTile letters={mark.letters} hue={mark.hue} size={size} />;
}

interface AgentMarkProps {
  provider: string;
  size: number;
}

export function AgentMark({ provider, size }: AgentMarkProps) {
  const known = providerIdSchema.safeParse(provider);
  if (!known.success) return <MarkTile letters={provider.slice(0, 1).toUpperCase()} size={size} />;
  return <ProviderMark providerId={known.data} size={size} />;
}
