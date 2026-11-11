import { describe, expect, it } from 'vitest';
import { blobResourceToClaude } from '@agentclientprotocol/claude-agent-acp/dist/blob-resources.js';
import packageJson from '@agentclientprotocol/claude-agent-acp/package.json' with { type: 'json' };

const PINNED_VERSION = '0.101.0';

describe('the pinned claude-agent-acp adapter and PDF blobs', () => {
  it('is the version the PDF attachment claim was verified against', () => {
    expect(packageJson.version).toBe(PINNED_VERSION);
  });

  it('turns an application/pdf blob resource into a Claude document block', () => {
    const blob = Buffer.from('%PDF-1.7 fake').toString('base64');
    expect(
      blobResourceToClaude({ uri: 'attachment:///report.pdf', mimeType: 'application/pdf', blob }),
    ).toEqual({
      kind: 'document',
      block: {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: blob },
      },
    });
  });

  it('does not accept other binary types, which Spark sends by path', () => {
    const blob = Buffer.from('PK').toString('base64');
    expect(
      blobResourceToClaude({ uri: 'attachment:///a.zip', mimeType: 'application/zip', blob }),
    ).toBeUndefined();
  });
});
