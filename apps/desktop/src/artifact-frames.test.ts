import { describe, expect, it, vi } from 'vitest';
import {
  allowArtifactFrames,
  fromArtifactPage,
  guardSubframes,
  type FrameNavigation,
} from './artifact-frames.ts';

function navigations() {
  let listener: ((details: FrameNavigation) => void) | null = null;
  guardSubframes({
    on: (_event, handler) => {
      listener = handler;
    },
  });
  return (url: string, isMainFrame = false) => {
    const preventDefault = vi.fn();
    listener!({ url, isMainFrame, preventDefault });
    return preventDefault.mock.calls.length === 0;
  };
}

describe('artifact frames', () => {
  it('knows the artifact origin by its exact address', () => {
    allowArtifactFrames(4318);
    expect(fromArtifactPage('http://127.0.0.1:14318/v/abc')).toBe(true);
    expect(fromArtifactPage('http://localhost:14318/v/abc')).toBe(false);
    expect(fromArtifactPage('http://127.0.0.1:4318/api/conversations')).toBe(false);
    expect(fromArtifactPage(undefined)).toBe(false);
  });

  it('lets a frame load an artifact page and nothing else', () => {
    allowArtifactFrames(4318);
    const navigate = navigations();
    expect(navigate('http://127.0.0.1:14318/v/abc')).toBe(true);
    expect(navigate('https://example.com/?data=secret')).toBe(false);
    expect(navigate('http://127.0.0.1:4318/api/conversations')).toBe(false);
    expect(navigate('http://127.0.0.1:4318/', true)).toBe(true);
  });
});
