import { describe, expect, it } from 'vitest';
import { dismiss, isDismissed, noticeKey, restartNoticeText } from './restart-notice.ts';

const at = '2026-10-13T07:14:00.000Z';
const clock = () => '7:14';

function memory(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

describe('the notice after Spark restarted under a Terminal session', () => {
  it('says when Spark restarted and that the session kept running', () => {
    expect(restartNoticeText({ at, stepsComplete: true }, clock)).toBe(
      'Spark restarted at 7:14. This session kept running.',
    );
  });

  it('says so when steps from the gap could not be read back', () => {
    expect(restartNoticeText({ at, stepsComplete: false }, clock)).toBe(
      'Spark restarted at 7:14. This session kept running. Steps from while Spark was closed are not listed.',
    );
  });

  it('stays dismissed for that restart and shows again after the next one', () => {
    const storage = memory();
    const first = noticeKey('s1', { at, stepsComplete: true });
    expect(isDismissed(first, storage)).toBe(false);
    dismiss(first, storage);
    expect(isDismissed(first, storage)).toBe(true);
    const next = noticeKey('s1', { at: '2026-10-13T09:00:00.000Z', stepsComplete: true });
    expect(isDismissed(next, storage)).toBe(false);
  });

  it('shows the notice when storage is unavailable', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(isDismissed('k', broken)).toBe(false);
    expect(() => dismiss('k', broken)).not.toThrow();
  });
});
