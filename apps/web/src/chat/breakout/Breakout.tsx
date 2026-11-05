import './breakout.css';
import type { ReactNode } from 'react';

export function Breakout({ children }: { children: ReactNode }) {
  return (
    <div className="breakout">
      <div className="breakout-in">{children}</div>
    </div>
  );
}
