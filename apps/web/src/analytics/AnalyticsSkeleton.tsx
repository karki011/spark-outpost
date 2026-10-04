import './analytics-charts.css';
import './analytics.css';
import { OverviewSkeleton } from './OverviewSkeleton.tsx';

export function AnalyticsSkeleton() {
  return (
    <main className="page" aria-labelledby="an-title" aria-busy="true">
      <div className="an">
        <div className="an-wrap">
          <header className="an-head">
            <div>
              <h1 id="an-title">Analytics</h1>
              <p>Where time, money and quality go. Everything here is computed on this machine.</p>
            </div>
            <span className="an-skel" style={{ width: 300, height: 34 }} aria-hidden="true" />
          </header>
          <div className="an-tabs-row">
            <div className="an-tabs" aria-hidden="true">
              {[74, 56, 52].map((width) => (
                <span key={width} className="an-skel" style={{ width, height: 28 }} />
              ))}
            </div>
          </div>
          <div className="an-panel">
            <OverviewSkeleton />
          </div>
        </div>
      </div>
    </main>
  );
}
