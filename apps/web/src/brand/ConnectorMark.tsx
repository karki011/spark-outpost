import { MarkTile } from './MarkTile.tsx';

export type ConnectorId = 'github' | 'atlassian' | 'linear' | 'servicenow' | 'slack' | 'calendar';

const CONNECTOR_MARK: Record<ConnectorId, { letters: string; hue: number }> = {
  calendar: { letters: 'Ca', hue: 50 },
  github: { letters: 'GH', hue: 160 },
  atlassian: { letters: 'At', hue: 255 },
  linear: { letters: 'Li', hue: 290 },
  servicenow: { letters: 'SN', hue: 170 },
  slack: { letters: 'Sl', hue: 10 },
};

interface ConnectorMarkProps {
  connectorId: ConnectorId;
  size?: number;
}

export function ConnectorMark({ connectorId, size = 28 }: ConnectorMarkProps) {
  const mark = CONNECTOR_MARK[connectorId];
  return <MarkTile letters={mark.letters} hue={mark.hue} size={size} />;
}
