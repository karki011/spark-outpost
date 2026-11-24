import { providerIdSchema, type ConnectableId } from '@spark-outpost/contracts';
import type { LogoName } from './logo-paths.ts';
import { MarkTile } from './MarkTile.tsx';

const PROVIDER_MARK: Record<ConnectableId, { letters: string; hue: number; logo?: LogoName }> = {
  claude: { letters: 'C', hue: 45, logo: 'claude' },
  codex: { letters: 'X', hue: 240, logo: 'codex' },
  zai: { letters: 'Z', hue: 145, logo: 'zai' },
  custom: { letters: 'E', hue: 300 },
  jev: { letters: 'J', hue: 340 },
};

interface ProviderMarkProps {
  providerId: ConnectableId;
  size?: number;
}

export function ProviderMark({ providerId, size = 28 }: ProviderMarkProps) {
  const mark = PROVIDER_MARK[providerId];
  return <MarkTile letters={mark.letters} hue={mark.hue} logo={mark.logo} size={size} />;
}

interface AgentMarkProps {
  provider: string;
  size: number;
}

export function AgentMark({ provider, size }: AgentMarkProps) {
  const known = providerIdSchema.safeParse(provider);
  if (!known.success) return <MarkTile letters="" size={size} />;
  return <ProviderMark providerId={known.data} size={size} />;
}
