import type { CloneJob } from '@spark-outpost/contracts';
import { progressText } from './clone-form.ts';

interface CloneProgressProps {
  job: CloneJob;
  cancelling: boolean;
  onCancel: () => void;
  onClose: () => void;
}

export function CloneProgress({ job, cancelling, onCancel, onClose }: CloneProgressProps) {
  return (
    <>
      <div className="clone-body">
        <p className="clone-what">
          Cloning <b>{job.source}</b>
        </p>
        <div
          className={job.percent === null ? 'clone-bar wait' : 'clone-bar'}
          role="progressbar"
          aria-label="Clone progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={job.percent ?? undefined}
          aria-valuetext={progressText(job)}
        >
          <span style={{ width: `${job.percent ?? 100}%` }} />
        </div>
        <p className="clone-phase">
          <span role="status">{job.phase}</span>
          {job.percent !== null && <span aria-hidden="true">{job.percent}%</span>}
        </p>
        <p className="fdlg-note">
          You can close this window. The clone keeps running, and Add project shows it again.
        </p>
      </div>
      <div className="fdlg-foot">
        <span className="fdlg-path" title={job.destination}>
          {job.displayPath}
        </span>
        <button type="button" className="btn ghost sm" onClick={onClose}>
          Close
        </button>
        <button type="button" className="btn line sm" disabled={cancelling} onClick={onCancel}>
          {cancelling ? 'Cancelling…' : 'Cancel clone'}
        </button>
      </div>
    </>
  );
}

interface CloneFailedProps {
  job: CloneJob;
  onRetry: () => void;
  onClose: () => void;
}

export function CloneFailed({ job, onRetry, onClose }: CloneFailedProps) {
  return (
    <>
      <div className="clone-body">
        <div className="clone-failed" role="alert">
          <p className="clone-summary">{job.failure?.summary}</p>
          {job.failure?.detail && <pre className="clone-detail">{job.failure.detail}</pre>}
        </div>
        <p className="fdlg-note">
          Nothing was added to your projects. <b>{job.source}</b>
        </p>
      </div>
      <div className="fdlg-foot">
        <span className="fdlg-path" title={job.destination}>
          {job.displayPath}
        </span>
        <button type="button" className="btn ghost sm" onClick={onClose}>
          Close
        </button>
        <button type="button" className="btn primary sm" onClick={onRetry}>
          Try again
        </button>
      </div>
    </>
  );
}
