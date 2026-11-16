import type { ReactNode } from 'react';
import { BlobScout, type ScoutMood } from '../brand/BlobScout.tsx';

interface HomeHeaderProps {
  text: string;
  mood: ScoutMood;
  loading: boolean;
  aside: ReactNode;
}

export function HomeHeader({ text, mood, loading, aside }: HomeHeaderProps) {
  return (
    <header className="home-hero">
      <BlobScout size={40} mood={mood} lookAtPointer />
      <h1 id="home-greet" aria-live="polite" aria-busy={loading}>
        {loading ? <span className="hsk summary" aria-hidden="true" /> : text}
      </h1>
      {aside}
    </header>
  );
}
