// @vitest-environment jsdom
import { useRef } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VoiceEvent } from '@spark-outpost/contracts';
import { useVoicePressTarget } from './press-target.ts';

function installSpeech() {
  const listeners = new Set<(event: VoiceEvent) => void>();
  const speech = {
    setPressTarget: vi.fn(async () => undefined),
    pressIsland: vi.fn(async () => undefined),
    onEvent: (callback: (event: VoiceEvent) => void) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
  (window as unknown as { sparkDesktop: unknown }).sparkDesktop = { speech };
  const emit = (event: VoiceEvent) => listeners.forEach((listener) => listener(event));
  return { speech, emit, listeners };
}

function Input(props: { toggle: () => void; enabled: boolean; shown: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useVoicePressTarget(props.toggle, props.enabled, ref);
  return (
    <textarea
      ref={(element) => {
        ref.current = element;
        if (element) {
          element.getClientRects = () => (props.shown ? [{}] : []) as unknown as DOMRectList;
        }
      }}
    />
  );
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { sparkDesktop?: unknown }).sparkDesktop;
});

describe('voice press target', () => {
  it('tells the desktop a target exists and toggles dictation on a press', () => {
    const { speech, emit } = installSpeech();
    const toggle = vi.fn();
    render(<Input toggle={toggle} enabled shown />);
    expect(speech.setPressTarget).toHaveBeenCalledWith(true);
    emit({ kind: 'press' });
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(speech.pressIsland).not.toHaveBeenCalled();
  });

  it('hands a press to the island when no input is on screen', () => {
    const { speech, emit } = installSpeech();
    const toggle = vi.fn();
    render(<Input toggle={toggle} enabled shown={false} />);
    emit({ kind: 'press' });
    expect(toggle).not.toHaveBeenCalled();
    expect(speech.pressIsland).toHaveBeenCalledTimes(1);
  });

  it('uses the input of the focused pane only', () => {
    const { emit } = installSpeech();
    const left = vi.fn();
    const right = vi.fn();
    render(
      <>
        <Input toggle={left} enabled shown />
        <Input toggle={right} enabled={false} shown />
      </>,
    );
    emit({ kind: 'press' });
    expect(left).toHaveBeenCalledTimes(1);
    expect(right).not.toHaveBeenCalled();
  });

  it('stops listening for presses and says so when the last input goes away', () => {
    const { speech, emit, listeners } = installSpeech();
    const toggle = vi.fn();
    const view = render(<Input toggle={toggle} enabled shown />);
    view.unmount();
    expect(speech.setPressTarget).toHaveBeenLastCalledWith(false);
    expect(listeners.size).toBe(0);
    emit({ kind: 'press' });
    expect(toggle).not.toHaveBeenCalled();
  });

  it('hands the press to the island while a dialog covers the input', () => {
    const { speech, emit } = installSpeech();
    const toggle = vi.fn();
    render(
      <>
        <Input toggle={toggle} enabled shown />
        <div role="dialog" aria-modal="true" />
      </>,
    );
    emit({ kind: 'press' });
    expect(toggle).not.toHaveBeenCalled();
    expect(speech.pressIsland).toHaveBeenCalledTimes(1);
  });

  it('leaves a test press with a file to the island', () => {
    const { emit } = installSpeech();
    const toggle = vi.fn();
    render(<Input toggle={toggle} enabled shown />);
    emit({ kind: 'press', file: '/tmp/a.wav' });
    expect(toggle).not.toHaveBeenCalled();
  });
});
