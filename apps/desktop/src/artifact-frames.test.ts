import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  allowArtifactFrames,
  artifactLinkAddress,
  artifactLinkRequest,
  fromArtifactPage,
  guardSubframes,
  USER_ACTION_WINDOW_MS,
  type FrameGuardTarget,
  type FrameNavigation,
} from './artifact-frames.ts';

const ARTIFACT = 'http://127.0.0.1:14318/v/abc';
const linkTo = (address: string) => `http://127.0.0.1:14318/open?to=${encodeURIComponent(address)}`;

type Listener = (...args: never[]) => void;

function guarded(answer = true) {
  const listeners = new Map<string, Listener>();
  const contents = {
    on: (event: string, listener: Listener) => listeners.set(event, listener),
  } as unknown as FrameGuardTarget;
  let clock = 10_000;
  const asked: string[] = [];
  const opened: string[] = [];
  let settle: () => void = () => {};
  const answered = new Promise<void>((resolve) => {
    settle = resolve;
  });
  guardSubframes(contents, {
    confirm: async (address) => {
      asked.push(address);
      settle();
      return answer;
    },
    open: (address) => opened.push(address),
    now: () => clock,
  });
  const fire = (event: string, ...args: unknown[]) =>
    (listeners.get(event) as (...values: unknown[]) => void)(...args);
  return {
    asked,
    opened,
    answered,
    wait: (ms: number) => {
      clock += ms;
    },
    click: () => fire('before-mouse-event', {}, { type: 'mouseUp' }),
    press: (key: string) => fire('before-input-event', {}, { type: 'keyDown', key }),
    navigate(url: string, from: string | null = ARTIFACT, isMainFrame = false) {
      const preventDefault = vi.fn();
      const details: FrameNavigation = {
        url,
        isMainFrame,
        frame: from === null ? null : { url: from },
        preventDefault,
      };
      fire('will-frame-navigate', details);
      return preventDefault.mock.calls.length === 0;
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  allowArtifactFrames(4318);
});

describe('artifact frames', () => {
  it('knows the artifact origin by its exact address', () => {
    expect(fromArtifactPage('http://127.0.0.1:14318/v/abc')).toBe(true);
    expect(fromArtifactPage('http://localhost:14318/v/abc')).toBe(false);
    expect(fromArtifactPage('http://127.0.0.1:4318/api/conversations')).toBe(false);
    expect(fromArtifactPage(undefined)).toBe(false);
  });

  it('lets a frame load an artifact page and keeps every other address out of the frame', () => {
    const frame = guarded();
    expect(frame.navigate('http://127.0.0.1:14318/v/def')).toBe(true);
    expect(frame.navigate('https://example.com/?data=secret')).toBe(false);
    expect(frame.navigate('http://127.0.0.1:4318/api/conversations')).toBe(false);
    expect(frame.navigate('http://127.0.0.1:4318/', null, true)).toBe(true);
  });
});

describe('links in an artifact', () => {
  it('ask before opening a clicked link in the browser, showing its address', async () => {
    const frame = guarded(true);
    frame.click();
    expect(frame.navigate(linkTo('https://example.com/report?q=1'))).toBe(false);
    await frame.answered;
    await flush();
    expect(frame.asked).toEqual(['https://example.com/report?q=1']);
    expect(frame.opened).toEqual(['https://example.com/report?q=1']);
  });

  it('open nothing when the user cancels', async () => {
    const frame = guarded(false);
    frame.press('Enter');
    frame.navigate(linkTo('https://example.com/'));
    await frame.answered;
    await flush();
    expect(frame.asked).toEqual(['https://example.com/']);
    expect(frame.opened).toEqual([]);
  });

  it('never ask for a link request a script made without a click', async () => {
    const frame = guarded(true);
    frame.navigate(linkTo('https://example.com/silent'));
    frame.click();
    frame.wait(USER_ACTION_WINDOW_MS + 1);
    frame.navigate(linkTo('https://example.com/late'));
    frame.press('a');
    frame.navigate(linkTo('https://example.com/typed'));
    await flush();
    expect(frame.asked).toEqual([]);
    expect(frame.opened).toEqual([]);
  });

  it('ask once per click, and never for a plain navigation, other schemes, sign-ins in the address or other frames', async () => {
    const frame = guarded(true);
    frame.click();
    frame.navigate(linkTo('https://example.com/one'));
    frame.navigate(linkTo('https://example.com/two'));
    await frame.answered;
    await flush();
    frame.click();
    expect(frame.navigate('https://example.com/direct')).toBe(false);
    frame.click();
    frame.navigate(linkTo('file:///etc/passwd'));
    frame.click();
    frame.navigate(linkTo('https://user:pass@example.com/'));
    frame.click();
    frame.navigate(linkTo('https://example.com/elsewhere'), 'http://127.0.0.1:4318/');
    await flush();
    expect(frame.asked).toEqual(['https://example.com/one']);
  });

  it('read only web addresses without a sign-in as link addresses', () => {
    expect(artifactLinkAddress('https://example.com/a b')).toBe('https://example.com/a%20b');
    expect(artifactLinkAddress('https://bücher.example/')).toBe('https://xn--bcher-kva.example/');
    expect(artifactLinkAddress('javascript:alert(1)')).toBeNull();
    expect(artifactLinkAddress('mailto:a@example.com')).toBeNull();
    expect(artifactLinkAddress('https://a:b@example.com/')).toBeNull();
  });

  it('take link requests only from the artifact origin’s open path', () => {
    expect(artifactLinkRequest(linkTo('https://example.com/'))).toBe('https://example.com/');
    expect(artifactLinkRequest('http://127.0.0.1:14318/v/abc?to=https://example.com/')).toBeNull();
    expect(
      artifactLinkRequest(`http://127.0.0.1:4318/open?to=${encodeURIComponent('https://a.b/')}`),
    ).toBeNull();
  });
});
