import { describe, expect, it } from 'vitest';
import { shipFailureMessage } from './failure-hint.ts';
import { ShipGitError } from './git.ts';

const HOOK_OUTPUT = [
  '> nx run design-system-mcp:build',
  'design-system-mcp:build  ELIFECYCLE  Command failed with exit code 1.',
  'Pre-push checks failed.',
  'husky - pre-push script failed (code 1)',
  "error: failed to push some refs to 'github.com:acme/widgets.git'",
].join('\n');

describe('shipFailureMessage', () => {
  it('names the pre-push check and its reason when a hook stopped the push', () => {
    const message = shipFailureMessage(
      new ShipGitError('Pushing spark/x failed: husky - pre-push script failed', HOOK_OUTPUT),
    );
    expect(message).toContain("stopped by this repository's pre-push check");
    expect(message).toContain('design-system-mcp:build');
    expect(message).toContain('never skips hooks');
  });

  it('keeps the plain git reason for a push that failed without a hook', () => {
    const error = new ShipGitError('Pushing spark/x failed: remote hung up', 'remote hung up');
    expect(shipFailureMessage(error)).toBe('Pushing spark/x failed: remote hung up');
  });

  it('still explains branch protection rather than blaming a local hook', () => {
    const error = new ShipGitError(
      'Pushing spark/x failed: pre-receive hook declined',
      'remote: pre-push policy\npre-receive hook declined',
    );
    expect(shipFailureMessage(error)).toContain('branch protection');
  });
});
