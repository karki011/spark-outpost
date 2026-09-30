import { useRef, useState } from 'react';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import { slide } from '../ui/transitions.tsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { setupApi, setupKey } from '../api/setup.ts';
import { BlobScout, type ScoutMood } from '../brand/BlobScout.tsx';
import { burst } from '../ui/sparks.ts';
import { MeetSparkStep } from './MeetSparkStep.tsx';
import { ProviderStep } from './ProviderStep.tsx';
import { DoneStep } from './DoneStep.tsx';
import { ThemeStep } from './ThemeStep.tsx';
import { ToolsStep } from './ToolsStep.tsx';
import { Stepper } from './Stepper.tsx';
import '../ui/controls.css';
import './onboarding.css';

const STEP_LABELS = ['Meet Spark', 'Theme', 'AI provider', 'Tools', 'Done'];
const PROVIDER_STEP = 2;
const LEAVE_ANIMATION_MS = 250;

interface OnboardingProps {
  onFinished: () => void;
}

const PANE_OFFSET = 28;

const paneVariants: Variants = {
  enter: (direction: number) => ({ opacity: 0, x: PANE_OFFSET * direction }),
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({ opacity: 0, x: -PANE_OFFSET * direction }),
};

export function Onboarding({ onFinished }: OnboardingProps) {
  const queryClient = useQueryClient();
  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get });
  const resumeAt = setup.data?.profile.displayName.trim() ? PROVIDER_STEP : 0;
  const [step, setStep] = useState(resumeAt);
  const [maxStep, setMaxStep] = useState(resumeAt);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [displayName, setDisplayName] = useState(setup.data?.profile.displayName ?? '');
  const [scoutMood, setScoutMood] = useState<ScoutMood>(null);
  const [leaving, setLeaving] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  if (!setup.data) return null;
  const providers = setup.data.providers;
  const connected = providers.filter((provider) => provider.connection);

  function go(next: number) {
    setDirection(next >= step ? 1 : -1);
    setStep(next);
    setMaxStep((value) => Math.max(value, next));
  }

  function isStepEnabled(index: number): boolean {
    if (index > maxStep) return false;
    return index <= PROVIDER_STEP || connected.length > 0;
  }

  const canGoNext =
    step === 0 ? displayName.trim() !== '' : step === PROVIDER_STEP ? connected.length > 0 : true;

  function handleVerifyStart() {
    setScoutMood('working');
  }

  function handleVerifyOutcome(outcome: 'success' | 'failure') {
    if (outcome === 'failure') {
      setScoutMood('sad');
      setTimeout(() => setScoutMood(null), 2600);
    } else {
      setScoutMood('happy');
      setTimeout(() => setScoutMood(null), 2400);
    }
  }

  async function handleFinish() {
    const rect = cardRef.current?.getBoundingClientRect();
    if (rect) {
      burst(rect.left + rect.width / 2, rect.top + rect.height / 2, 34, 220);
      setTimeout(
        () => burst(rect.left + rect.width / 2, rect.top + rect.height * 0.35, 22, 160),
        180,
      );
    }
    const state = await setupApi.updateProfile({ onboardingCompleted: true });
    setLeaving(true);
    setTimeout(() => {
      queryClient.setQueryData(setupKey, state);
      onFinished();
    }, LEAVE_ANIMATION_MS);
  }

  function handleNext() {
    if (!canGoNext) return;
    if (step === STEP_LABELS.length - 1) void handleFinish();
    else go(step + 1);
  }

  const footerStatus =
    step === 0
      ? displayName.trim()
        ? ''
        : 'Enter your name to continue.'
      : step === PROVIDER_STEP && connected.length === 0
        ? 'Connect at least one provider to continue.'
        : step === 3
          ? 'Everything here is optional.'
          : '';

  return (
    <div className={`onb${leaving ? ' leave' : ''}`}>
      <div className="onb-page" ref={cardRef}>
        <aside className="onb-rail">
          <div className="onb-brand">
            <BlobScout size={28} mood={scoutMood} className="onbs" />
            <b>spark outpost</b>
          </div>
          <Stepper steps={STEP_LABELS} current={step} isEnabled={isStepEnabled} onSelect={go} />
          <p className="onb-rail-note">
            Setup takes about two minutes. You can change any of it later.
          </p>
        </aside>
        <main className="onb-main" aria-labelledby="onbTitle">
          <div className="onb-body">
            <AnimatePresence mode="popLayout" initial={false} custom={direction}>
              <motion.div
                key={step}
                className="pane"
                custom={direction}
                variants={paneVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={slide}
              >
                {step === 0 && (
                  <MeetSparkStep
                    profile={setup.data.profile}
                    displayName={displayName}
                    onDisplayNameChange={setDisplayName}
                    onEnter={handleNext}
                  />
                )}
                {step === 1 && <ThemeStep />}
                {step === PROVIDER_STEP && (
                  <ProviderStep
                    providers={providers}
                    advisors={setup.data.advisors}
                    defaultProvider={setup.data.profile.defaultProvider}
                    onVerifyStart={handleVerifyStart}
                    onVerifyOutcome={handleVerifyOutcome}
                  />
                )}
                {step === 3 && <ToolsStep />}
                {step === 4 && (
                  <DoneStep
                    displayName={displayName}
                    providers={providers}
                    defaultProvider={setup.data.profile.defaultProvider}
                    level={setup.data.profile.defaultLevel}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="onb-foot">
            <button
              type="button"
              className="btn ghost"
              style={{ visibility: step === 0 ? 'hidden' : 'visible' }}
              onClick={() => go(step - 1)}
            >
              Back
            </button>
            <span className="why" aria-live="polite">
              {footerStatus}
            </span>
            <button
              type="button"
              className="btn primary"
              disabled={!canGoNext}
              onClick={handleNext}
            >
              {step === STEP_LABELS.length - 1 ? 'Open Spark Outpost' : 'Continue'}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
