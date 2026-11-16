import './crew-empty.css';
import { useId, type CSSProperties, type ReactNode } from 'react';
import { TEAMMATE_STARTERS } from '@spark-outpost/contracts';
import { TeammateFace } from '../teammates/TeammateFace.tsx';

interface CrewEmptyPoint {
  title: string;
  detail: string;
}

interface CrewEmptyProps {
  title: string;
  lede: string;
  points: readonly CrewEmptyPoint[];
  children?: ReactNode;
  after?: ReactNode;
}

const FACES = TEAMMATE_STARTERS.map((starter) => starter.face);
const BIG = 1;

export function CrewEmpty({ title, lede, points, children, after }: CrewEmptyProps) {
  const headingId = useId();
  return (
    <section className="crew-empty" aria-labelledby={headingId}>
      <div className="crew-empty-blobs" aria-hidden="true">
        {FACES.map((face, index) => (
          <span
            key={`${face.shape}-${face.color}`}
            className="crew-empty-blob"
            style={{ '--i': index } as CSSProperties}
          >
            <TeammateFace face={face} size={index === BIG ? 76 : 54} />
          </span>
        ))}
      </div>
      <h2 id={headingId}>{title}</h2>
      <p className="crew-empty-lede">{lede}</p>
      <ul className="crew-empty-points">
        {points.map((point) => (
          <li key={point.title}>
            <b>{point.title}</b>
            <span>{point.detail}</span>
          </li>
        ))}
      </ul>
      {children && <div className="crew-empty-acts">{children}</div>}
      {after}
    </section>
  );
}
