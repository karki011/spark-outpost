import { Blobatar } from 'blobatar/react';
import * as expressions from 'blobatar/expression';
import { crewExpression, crewHue, type CrewState } from './crew-model.ts';

export function crewSeed(name: string): string {
  return `crew:${name}`;
}

interface CrewBlobProps {
  name: string;
  provider: string;
  state: CrewState;
  size: number;
}

export function CrewBlob({ name, provider, state, size }: CrewBlobProps) {
  const live = state === 'working' || state === 'thinking' || state === 'waiting';
  return (
    <Blobatar
      name={crewSeed(name)}
      hue={crewHue(provider)}
      size={size}
      animate={live ? 'always' : 'hover'}
      expression={expressions[crewExpression(state)]}
      className="crew-blob"
      aria-hidden="true"
    />
  );
}
