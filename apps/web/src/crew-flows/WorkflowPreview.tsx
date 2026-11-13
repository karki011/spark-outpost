import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { previewWorkflow, type WorkflowStep } from '@spark-outpost/contracts';
import { BackIcon, EyeIcon, ForwardIcon, PauseIcon, ResumeIcon } from '../ui/icons.tsx';
import { positionLabel, previewResult, statesAt } from './preview-model.ts';
import type { CrewSpark } from './spark-lookup.ts';
import { SparkDot } from './StagePreview.tsx';
import { StepState } from './StepState.tsx';

const FlowGraph = lazy(() => import('./FlowGraph.tsx'));
const PLAY_MS = 900;

interface WorkflowPreviewProps {
  steps: readonly WorkflowStep[];
  labels: ReadonlyMap<string, string>;
  sparkById: ReadonlyMap<string, CrewSpark>;
  onContinue: (stepId: string) => void;
}

export function WorkflowPreview({ steps, labels, sparkById, onContinue }: WorkflowPreviewProps) {
  const [failing, setFailing] = useState<ReadonlySet<string>>(new Set());
  const preview = useMemo(() => previewWorkflow(steps, failing), [steps, failing]);
  const total = preview.rounds.length;
  const [position, setPosition] = useState(total);
  const [playRequested, setPlaying] = useState(false);
  const at = Math.min(position, total);
  const playing = playRequested && at < total;
  const states = useMemo(() => statesAt(preview, at), [preview, at]);
  const result = previewResult(steps, preview, labels);

  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => setPosition(at + 1), PLAY_MS);
    return () => clearTimeout(timer);
  }, [playing, at]);

  const toggleFailing = (id: string) => {
    const next = new Set(failing);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setFailing(next);
    setPlaying(false);
    setPosition(Number.MAX_SAFE_INTEGER);
  };
  const play = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (at >= total) setPosition(0);
    setPlaying(true);
  };

  return (
    <div className="wf-preview">
      <div className="wf-banner">
        <span className="wf-banner-t">
          <EyeIcon />
          <b>Preview</b>
        </span>
        <span className="wf-banner-d">
          No agents run and nothing is spent. This only shows the order.
        </span>
        <span className="wf-transport" role="group" aria-label="Playback">
          <button
            type="button"
            className="btn line sm"
            aria-label="Step back"
            disabled={at <= 0}
            onClick={() => {
              setPlaying(false);
              setPosition(at - 1);
            }}
          >
            <BackIcon />
          </button>
          <button type="button" className="btn line sm" onClick={play}>
            {playing ? <PauseIcon /> : <ResumeIcon />}
            {playing ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            className="btn line sm"
            aria-label="Step forward"
            disabled={at >= total}
            onClick={() => {
              setPlaying(false);
              setPosition(at + 1);
            }}
          >
            <ForwardIcon />
          </button>
          <span className="wf-position" role="status">
            {positionLabel(preview, at)}
          </span>
        </span>
      </div>
      <div className="wf-body">
        <div className="wf-canvas">
          <Suspense fallback={null}>
            <FlowGraph
              steps={steps}
              labels={labels}
              sparks={sparkById}
              states={states}
              label={`Preview of the workflow. ${result.headline}`}
            />
          </Suspense>
        </div>
        <div className="wf-col wf-col-right">
          <h3>What if</h3>
          <p className="wf-hint">Pretend a step fails to see what happens next.</p>
          <ul className="wf-whatif" aria-label="Steps">
            {steps.map((step) => {
              const label = labels.get(step.id) ?? step.id;
              return (
                <li key={step.id} data-failing={failing.has(step.id) || undefined}>
                  <SparkDot spark={sparkById.get(step.sparkId)} size={24} />
                  <span className="wf-whatif-name">
                    <b>{label}</b>
                    <StepState state={states[step.id] ?? 'waiting'} />
                  </span>
                  <label className="wf-check">
                    <input
                      type="checkbox"
                      aria-label={`Pretend ${label} fails`}
                      checked={failing.has(step.id)}
                      onChange={() => toggleFailing(step.id)}
                    />
                    Pretend this fails
                  </label>
                </li>
              );
            })}
          </ul>
          <h3>Result</h3>
          <div className="wf-result" role="status">
            <b>{result.headline}</b>
            <ul>
              {result.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          {result.stoppedBy !== null && (
            <button
              type="button"
              className="btn line sm"
              onClick={() => onContinue(result.stoppedBy!)}
            >
              Change {labels.get(result.stoppedBy) ?? result.stoppedBy} to Continue
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
