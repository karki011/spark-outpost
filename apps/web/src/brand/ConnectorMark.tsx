import type { LogoName } from './logo-paths.ts';
import { MarkTile } from './MarkTile.tsx';

export type ConnectorId =
  'github' | 'atlassian' | 'linear' | 'servicenow' | 'slack' | 'calendar' | 'zoom' | 'cloudflare';

const CONNECTOR_MARK: Record<ConnectorId, { letters: string; hue: number; logo?: LogoName }> = {
  calendar: { letters: 'Ca', hue: 50 },
  github: { letters: 'GH', hue: 160, logo: 'github' },
  atlassian: { letters: 'At', hue: 255, logo: 'atlassian' },
  linear: { letters: 'Li', hue: 290, logo: 'linear' },
  servicenow: { letters: 'SN', hue: 170, logo: 'servicenow' },
  slack: { letters: 'Sl', hue: 10, logo: 'slack' },
  zoom: { letters: 'Zo', hue: 230 },
  cloudflare: { letters: 'Cf', hue: 35, logo: 'cloudflare' },
};

interface ConnectorMarkProps {
  connectorId: ConnectorId;
  size?: number;
}

export function ConnectorMark({ connectorId, size = 28 }: ConnectorMarkProps) {
  const mark = CONNECTOR_MARK[connectorId];
  return <MarkTile letters={mark.letters} hue={mark.hue} logo={mark.logo} size={size} />;
}
