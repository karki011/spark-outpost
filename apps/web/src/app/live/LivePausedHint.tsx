import '../connection/connection.css';

export function LivePausedHint() {
  return (
    <p className="live-paused" role="status">
      Live updates paused, retrying
    </p>
  );
}
