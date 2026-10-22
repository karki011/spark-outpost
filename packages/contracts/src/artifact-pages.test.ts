import { describe, expect, it } from 'vitest';
import { artifactPortFor, artifactUri, parseArtifactUri } from './artifact-pages.ts';

describe('artifactPortFor', () => {
  it('puts the artifact origin above the API port when it fits', () => {
    expect(artifactPortFor(34_567)).toBe(44_567);
  });

  it('stays in range for a high API port by going below it', () => {
    expect(artifactPortFor(60_000)).toBe(50_000);
    expect(artifactPortFor(65_535)).toBe(55_535);
  });

  it('never equals the API port and stays a valid port', () => {
    for (const port of [1, 4318, 30_000, 39_999, 55_535, 55_536, 65_535]) {
      const artifact = artifactPortFor(port);
      expect(artifact).not.toBe(port);
      expect(artifact).toBeGreaterThan(0);
      expect(artifact).toBeLessThanOrEqual(65_535);
    }
  });
});

describe('artifact uris', () => {
  it('round-trips a chat and artifact id', () => {
    const chat = '6f1c2d3e-4b5a-4c6d-8e7f-0123456789ab';
    const id = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
    expect(parseArtifactUri(artifactUri(chat, id))).toEqual({
      conversationId: chat,
      artifactId: id,
    });
  });

  it('ignores another server ui uri', () => {
    expect(parseArtifactUri('ui://weather/forecast')).toBeNull();
  });
});
