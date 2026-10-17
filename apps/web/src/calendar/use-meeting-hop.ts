import { useEffect, useRef, useState } from 'react';
import { playMeetingChime, routeChime } from '../island/island-sound.ts';

export const HOP_MS = 1_300;

export function meetingChimeRoute(held: boolean, soundOn: boolean): 'play' | 'skip' {
  return routeChime(held, soundOn) === 'play' ? 'play' : 'skip';
}

export function useMeetingHop(key: string | null, soundOn: boolean, held: boolean): boolean {
  const [hopping, setHopping] = useState(false);
  const seen = useRef(new Set<string>());
  const facts = useRef({ soundOn, held });
  useEffect(() => {
    facts.current = { soundOn, held };
  }, [soundOn, held]);
  useEffect(() => {
    if (!key || seen.current.has(key)) return;
    seen.current.add(key);
    setHopping(true);
    if (meetingChimeRoute(facts.current.held, facts.current.soundOn) === 'play') {
      playMeetingChime();
    }
  }, [key]);
  useEffect(() => {
    if (!hopping) return;
    const timer = setTimeout(() => setHopping(false), HOP_MS);
    return () => clearTimeout(timer);
  }, [hopping]);
  return hopping;
}
