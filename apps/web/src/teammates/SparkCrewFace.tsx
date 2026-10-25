import './spark-mention.css';
import { faceFromName, type TeammateState } from '@spark-outpost/contracts';
import type { CrewState } from '../crew/crew-model.ts';
import { TeammateFace } from './TeammateFace.tsx';
import { useTeammates } from './use-teammates.ts';

const FACE_STATES: Record<CrewState, TeammateState> = {
  inactive: 'idle',
  thinking: 'working',
  working: 'working',
  waiting: 'needs_you',
  done: 'done',
  failed: 'failed',
  stopped: 'idle',
  queued: 'idle',
};

interface SparkCrewFaceProps {
  sparkId: string;
  name: string;
  size: number;
  state?: CrewState;
}

export function SparkCrewFace({ sparkId, name, size, state = 'stopped' }: SparkCrewFaceProps) {
  const { teammates } = useTeammates();
  const face = teammates.find((teammate) => teammate.id === sparkId)?.face ?? faceFromName(name);
  return <TeammateFace face={face} size={size} state={FACE_STATES[state]} />;
}

interface SparkTagProps {
  sparkId: string;
  name: string;
  role: string;
}

export function SparkTag({ sparkId, name, role }: SparkTagProps) {
  return (
    <span className="spark-tag">
      <SparkCrewFace sparkId={sparkId} name={name} size={16} />
      {name}
      {role && <small>{role}</small>}
    </span>
  );
}
