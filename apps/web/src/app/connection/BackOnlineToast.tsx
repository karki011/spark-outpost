import { useEffect, useState } from 'react';
import './connection.css';

const VISIBLE_MS = 2400;
const LEAVE_MS = 160;

export function BackOnlineToast() {
  const [phase, setPhase] = useState<'shown' | 'leaving' | 'gone'>('shown');

  useEffect(() => {
    const leave = setTimeout(() => setPhase('leaving'), VISIBLE_MS);
    const remove = setTimeout(() => setPhase('gone'), VISIBLE_MS + LEAVE_MS);
    return () => {
      clearTimeout(leave);
      clearTimeout(remove);
    };
  }, []);

  if (phase === 'gone') return null;
  return (
    <div className={`online-toast${phase === 'leaving' ? ' out' : ''}`} role="status">
      <i aria-hidden="true" />
      Back online
    </div>
  );
}
