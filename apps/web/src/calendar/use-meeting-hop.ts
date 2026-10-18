import { useEffect, useRef, useState } from 'react';
import { playMeetingChime, routeChime } from '../island/island-sound.ts';

export const HOP_MS = 1_300;

export function meetingChimeRoute(held: boolean, soundOn: boolean): 'play' | 'skip' {
  return routeChime(held, soundOn) === 'play' ? 'play' : 'skip';
}

const KEY_SEPARATOR = '\n';

export function useMeetingHop(keys: readonly string[], soundOn: boolean, held: boolean): boolean {
  const [hopping, setHopping] = useState(false);
  const seen = useRef(new Set<string>());
  const facts = useRef({ soundOn, held });
  useEffect(() => {
    facts.current = { soundOn, held };
  }, [soundOn, held]);
  const joined = keys.join(KEY_SEPARATOR);
  useEffect(() => {
    const group = joined ? joined.split(KEY_SEPARATOR) : [];
    const lead = group[0];
    const fresh = lead !== undefined && !seen.current.has(lead);
    group.forEach((key) => seen.current.add(key));
    if (!fresh) return;
    setHopping(true);
    if (meetingChimeRoute(facts.current.held, facts.current.soundOn) === 'play') {
      playMeetingChime();
    }
  }, [joined]);
  useEffect(() => {
    if (!hopping) return;
    const timer = setTimeout(() => setHopping(false), HOP_MS);
    return () => clearTimeout(timer);
  }, [hopping]);
  return hopping;
}
