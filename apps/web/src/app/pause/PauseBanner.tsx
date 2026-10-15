import { createPortal } from 'react-dom';
import { usePanelElement } from '../connection/use-panel-anchor.ts';
import { useSparkPause } from './use-spark-pause.ts';
import './pause.css';

export function PauseBanner() {
  const { paused, saving, setPaused } = useSparkPause();
  const panel = usePanelElement();
  if (!paused || !panel) return null;
  return createPortal(
    <div className="spark-paused" role="status">
      <b>Spark is paused</b>
      <small>Automatic work is held. Messages you send still run.</small>
      <button
        type="button"
        className="btn line sm"
        disabled={saving}
        onClick={() => setPaused(false)}
      >
        Resume
      </button>
    </div>,
    panel,
  );
}
