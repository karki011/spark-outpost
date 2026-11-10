import { BlobScout, type ScoutMood } from '../brand/BlobScout.tsx';
import { clock } from '../calendar/calendar-format.ts';

interface HomeHeaderProps {
  text: string;
  mood: ScoutMood;
  loading: boolean;
  now: number;
}

export function HomeHeader({ text, mood, loading, now }: HomeHeaderProps) {
  const day = new Date(now).toLocaleDateString(undefined, { weekday: 'long' });
  return (
    <header className="home-hero">
      <BlobScout size={54} mood={mood} lookAtPointer />
      <div className="hh-t">
        <p className="hh-time">
          {day} {clock(now)}
        </p>
        <h1 id="home-greet" aria-live="polite" aria-busy={loading}>
          {loading ? <span className="hsk summary" aria-hidden="true" /> : text}
        </h1>
      </div>
    </header>
  );
}
