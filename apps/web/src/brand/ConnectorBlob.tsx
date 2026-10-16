import { Blobatar } from 'blobatar/react';
import * as expressions from 'blobatar/expression';
import type { BlobExpression } from './blob-expression.ts';

export type ConnectorId = 'github' | 'jira' | 'linear' | 'slack' | 'calendar';

const CONNECTOR_SEED: Record<ConnectorId, { name: string; hue: number }> = {
  calendar: { name: 'connector:calendar', hue: 28 },
  github: { name: 'connector:github', hue: 145 },
  jira: { name: 'connector:jira', hue: 232 },
  linear: { name: 'connector:linear', hue: 268 },
  slack: { name: 'connector:slack', hue: 352 },
};

interface ConnectorBlobProps {
  connectorId: ConnectorId;
  size?: number;
  expression?: BlobExpression;
  animate?: 'always' | 'hover';
}

export function ConnectorBlob({
  connectorId,
  size = 42,
  expression = 'idle',
  animate = 'hover',
}: ConnectorBlobProps) {
  const seed = CONNECTOR_SEED[connectorId];
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
