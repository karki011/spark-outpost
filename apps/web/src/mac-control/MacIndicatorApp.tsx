import { useEffect, useState } from 'react';
import type { MacIndicator } from '@spark-outpost/contracts';
import { desktopMacControl } from '../desktop/desktop-bridge.ts';
import './mac-indicator.css';

export function MacIndicatorApp() {
  const mac = desktopMacControl();
  const [state, setState] = useState<MacIndicator | null>(null);

  useEffect(() => {
    if (!mac) return;
    void mac.indicator().then((current) => setState(current));
    return mac.onIndicator(setState);
  }, [mac]);

  if (!mac || !state) return null;
  return (
    <div className="mci" role="status" aria-live="polite">
      <span className={state.paused ? 'mci-dot paused' : 'mci-dot'} aria-hidden="true" />
      <div className="mci-text">
        <b>
          {state.paused ? 'Paused: you took over ' : 'Spark is controlling '}
          {state.app}
        </b>
        <span>{state.paused ? 'Resume to let the agent go on.' : (state.did ?? ' ')}</span>
      </div>
      {state.paused && (
        <button type="button" className="mci-btn" onClick={() => void mac.resume()}>
          Resume
        </button>
      )}
      <button
        type="button"
        className="mci-btn stop"
        title="Stop Mac control (⌃⌥⌘.)"
        onClick={() => void mac.stop()}
      >
        Stop
      </button>
    </div>
  );
}
