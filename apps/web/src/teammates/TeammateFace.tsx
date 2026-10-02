import './teammates.css';
import './teammate-chips.css';
import { Blobatar } from 'blobatar/react';
import * as expressions from 'blobatar/expression';
import type { TeammateFace as Face, TeammateState } from '@spark-outpost/contracts';
import { useReducedMotion } from '../ui/motion.ts';
import { faceRender, stateExpression } from './face-style.ts';

interface TeammateFaceProps {
  face: Face;
  size: number;
  state?: TeammateState;
}

export function TeammateFace({ face, size, state = 'idle' }: TeammateFaceProps) {
  const reduced = useReducedMotion();
  const render = faceRender(face);
  const live = !reduced && (state === 'working' || state === 'needs_you');
  return (
    <Blobatar
      name={render.seed}
      hue={render.hue}
      tone={render.tone}
      traits={render.traits}
      size={size}
      animate={live ? 'always' : 'hover'}
      expression={expressions[stateExpression(state)]}
      className="tm-face"
      aria-hidden="true"
    />
  );
}
