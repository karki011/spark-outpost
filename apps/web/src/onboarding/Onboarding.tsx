import { useRef, useState } from 'react';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import { VOICE_DEFAULT_MODEL } from '@spark-outpost/contracts';
import { slide } from '../ui/transitions.tsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { setupApi, setupKey } from '../api/setup.ts';
import { BlobScout, type ScoutMood } from '../brand/BlobScout.tsx';
import { FullDiskAccess } from '../settings/FullDiskAccess.tsx';
import { fullDiskAccessQuery } from '../settings/full-disk-access-status.ts';
import { burst } from '../ui/sparks.ts';
import { MeetSparkStep } from './MeetSparkStep.tsx';
import { ProviderStep } from './ProviderStep.tsx';
import { DoneStep } from './DoneStep.tsx';
import { ThemeStep } from './ThemeStep.tsx';
import { ToolsStep } from './ToolsStep.tsx';
import { desktopSpeech, useSpeechStatus } from '../voice/speech-bridge.ts';
import { voiceContinueLabel, VoiceStep, type VoiceChoice } from './VoiceStep.tsx';
import { Stepper } from './Stepper.tsx';
import '../ui/controls.css';
import './onboarding.css';

type StepId = 'meet' | 'theme' | 'provider' | 'tools' | 'mac-access' | 'voice' | 'done';

const STEP_LABELS: Record<StepId, string> = {
  meet: 'Meet Spark',
  theme: 'Appearance',
  provider: 'AI provider',
  tools: 'Tools',
  'mac-access': 'Mac access',
  voice: 'Voice',
  done: 'Done',
};

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
  const fullDiskAccess = useQuery(fullDiskAccessQuery);
  const speech = desktopSpeech();
  const voiceStatus = useSpeechStatus();
  const macAccess = fullDiskAccess.data && fullDiskAccess.data.status !== 'unsupported';
  const voice = speech !== null && voiceStatus?.helper !== 'missing';
  const steps: StepId[] = [
    'meet',
    'theme',
    'provider',
    'tools',
    ...(macAccess ? (['mac-access'] as const) : []),
    ...(voice ? (['voice'] as const) : []),
    'done',
  ];
  const providerStepIndex = steps.indexOf('provider');
  const resumeAt = setup.data?.profile.displayName.trim() ? providerStepIndex : 0;
  const [step, setStep] = useState(resumeAt);
  const [maxStep, setMaxStep] = useState(resumeAt);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [displayName, setDisplayName] = useState(setup.data?.profile.displayName ?? '');
  const [scoutMood, setScoutMood] = useState<ScoutMood>(null);
  const [leaving, setLeaving] = useState(false);
  const [voicePick, setVoicePick] = useState<VoiceChoice | null>(null);
  const voiceStarted = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);

  if (!setup.data || fullDiskAccess.isPending) return null;
  const providers = setup.data.providers;
  const connected = providers.filter((provider) => provider.connection);
  const current = steps[step] ?? 'meet';
  const lastStep = steps.length - 1;
  const voiceChoice = voicePick ?? VOICE_DEFAULT_MODEL;

  function go(next: number) {
    setDirection(next >= step ? 1 : -1);
    setStep(next);
    setMaxStep((value) => Math.max(value, next));
  }

  function isStepEnabled(index: number): boolean {
    if (index > maxStep) return false;
    return index <= providerStepIndex || connected.length > 0;
  }

  const canGoNext =
    current === 'meet'
      ? displayName.trim() !== ''
      : current === 'provider'
        ? connected.length > 0
        : true;

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

  function applyVoice() {
    if (!speech) return;
    if (voiceChoice === 'none') {
      if (voiceStarted.current) void speech.turnOff();
      voiceStarted.current = false;
      return;
    }
    if (!voiceStarted.current) void speech.turnOn();
    voiceStarted.current = true;
  }

  function handleNext() {
    if (!canGoNext) return;
    if (current === 'voice') applyVoice();
    if (step === lastStep) void handleFinish();
    else go(step + 1);
  }

  const footerStatus =
    current === 'meet'
      ? displayName.trim()
        ? ''
        : 'Enter your name to continue.'
      : current === 'provider' && connected.length === 0
        ? 'Connect at least one provider to continue.'
        : current === 'tools'
          ? 'Everything here is optional.'
          : current === 'mac-access'
            ? 'Optional. You can do this later in Settings.'
            : current === 'voice' && voiceChoice !== 'none' && voiceStatus?.mic !== 'granted'
              ? 'macOS asks for the microphone when you continue.'
              : '';

  return (
    <div className={`onb${leaving ? ' leave' : ''}`}>
      <div className="onb-page" ref={cardRef}>
        <aside className="onb-rail">
          <div className="onb-brand">
            <BlobScout size={28} mood={scoutMood} className="onbs" />
            <b>spark outpost</b>
          </div>
          <Stepper
            steps={steps.map((id) => STEP_LABELS[id])}
            current={step}
            isEnabled={isStepEnabled}
            onSelect={go}
          />
          <p className="onb-rail-note">
            Setup takes about two minutes. You can change any of it later.
          </p>
        </aside>
        <main
          className={current === 'theme' ? 'onb-main wide' : 'onb-main'}
          aria-labelledby="onbTitle"
        >
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
                {current === 'meet' && (
                  <MeetSparkStep
                    profile={setup.data.profile}
                    displayName={displayName}
                    onDisplayNameChange={setDisplayName}
                    onEnter={handleNext}
                  />
                )}
                {current === 'theme' && <ThemeStep />}
                {current === 'provider' && (
                  <ProviderStep
                    providers={providers}
                    advisors={setup.data.advisors}
                    defaultProvider={setup.data.profile.defaultProvider}
                    onVerifyStart={handleVerifyStart}
                    onVerifyOutcome={handleVerifyOutcome}
                  />
                )}
                {current === 'tools' && <ToolsStep />}
                {current === 'mac-access' && (
                  <>
                    <h2 id="onbTitle">Mac access</h2>
                    <p className="lede">
                      Optional. Skip it now and turn it on later in Settings → Help.
                    </p>
                    <FullDiskAccess />
                  </>
                )}
                {current === 'voice' && <VoiceStep choice={voiceChoice} onChoose={setVoicePick} />}
                {current === 'done' && (
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
            <div className="onb-foot-row">
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
                {step === lastStep
                  ? 'Open Spark Outpost'
                  : current === 'voice'
                    ? voiceContinueLabel(voiceChoice, voiceStatus)
                    : 'Continue'}
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
