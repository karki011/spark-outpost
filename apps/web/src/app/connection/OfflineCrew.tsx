import { useEffect, useState, type CSSProperties } from 'react';
import { Blobatar } from 'blobatar/react';
import * as expressions from 'blobatar/expression';
import { crewSeed } from '../../crew/CrewBlob.tsx';
import { crewHue } from '../../crew/crew-model.ts';

const POKE_EVERY_MS = 9000;
const POKE_MS = 1300;

interface Walker {
  name: string;
  provider: string;
  side: 'left' | 'right';
  x: string;
  roam: number;
  roamSeconds: number;
  hopSeconds: number;
  delay: number;
}

const OFFLINE_CREW: readonly Walker[] = [
  {
    name: 'Bolt',
    provider: 'claude',
    side: 'left',
    x: '2%',
    roam: 16,
    roamSeconds: 5.6,
    hopSeconds: 2.3,
    delay: 0,
  },
  {
    name: 'Sketch',
    provider: 'codex',
    side: 'left',
    x: '17%',
    roam: 10,
    roamSeconds: 7.2,
    hopSeconds: 3.1,
    delay: -1.8,
  },
  {
    name: 'Hawk',
    provider: 'codex',
    side: 'right',
    x: '68%',
    roam: 12,
    roamSeconds: 6.4,
    hopSeconds: 2.7,
    delay: -3.1,
  },
  {
    name: 'Jev',
    provider: 'jev',
    side: 'right',
    x: '84%',
    roam: 15,
    roamSeconds: 8.1,
    hopSeconds: 3.6,
    delay: -0.9,
  },
];

interface OfflineCrewProps {
  back: boolean;
  still: boolean;
  paused: boolean;
  onPoke: () => void;
}

function usePoker(active: boolean, onPoke: () => void): string | null {
  const [poker, setPoker] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    let turn = 0;
    let settle: ReturnType<typeof setTimeout> | null = null;
    const interval = setInterval(() => {
      const walker = OFFLINE_CREW[turn % OFFLINE_CREW.length]!;
      turn += 1;
      setPoker(walker.name);
      onPoke();
      settle = setTimeout(() => setPoker(null), POKE_MS);
    }, POKE_EVERY_MS);
    return () => {
      clearInterval(interval);
      if (settle) clearTimeout(settle);
      setPoker(null);
    };
  }, [active, onPoke]);
  return poker;
}

export function OfflineCrew({ back, still, paused, onPoke }: OfflineCrewProps) {
  const poker = usePoker(!back && !still && !paused, onPoke);
  const classes = ['offline-crew', back && 'back', still && 'still', paused && 'paused'];
  return (
    <div className={classes.filter(Boolean).join(' ')} aria-hidden="true">
      {OFFLINE_CREW.map((walker) => {
        const style = {
          left: walker.x,
          '--roam': `${walker.roam}px`,
          '--roam-s': `${walker.roamSeconds}s`,
          '--hop-s': `${walker.hopSeconds}s`,
          '--delay': `${walker.delay}s`,
        } as CSSProperties;
        const poking = poker === walker.name;
        return (
          <span
            key={walker.name}
            className={`ow ${walker.side}${poking ? ' poke' : ''}`}
            data-crew={walker.name}
            style={style}
          >
            <span className="ow-roam">
              <span className="ow-hop">
                <Blobatar
                  name={crewSeed(walker.name)}
                  hue={crewHue(walker.provider)}
                  size={34}
                  animate={still ? 'hover' : 'always'}
                  expression={
                    back ? expressions.happy : poking ? expressions.wink : expressions.idle
                  }
                  className="crew-blob"
                  aria-hidden="true"
                />
              </span>
            </span>
          </span>
        );
      })}
    </div>
  );
}
