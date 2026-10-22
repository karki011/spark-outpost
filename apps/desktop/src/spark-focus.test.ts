import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { watchSparkFocus, type FocusSource } from './spark-focus.ts';

function fakeApp() {
  const emitter = new EventEmitter();
  const source: FocusSource = {
    on: (event, listener) => emitter.on(event, listener as never),
    off: (event, listener) => emitter.off(event, listener as never),
  };
  return { emitter, source };
}

describe('watchSparkFocus', () => {
  it('rechecks focus when another app takes over, with no Spark window to blur', () => {
    const { emitter, source } = fakeApp();
    let checks = 0;
    watchSparkFocus(source, [], () => (checks += 1));
    emitter.emit('did-resign-active');
    expect(checks).toBe(1);
  });

  it('rechecks focus when a Spark window closes', () => {
    const { emitter, source } = fakeApp();
    let checks = 0;
    watchSparkFocus(source, [], () => (checks += 1));
    const window = new EventEmitter();
    emitter.emit('browser-window-created', {}, window);
    window.emit('closed');
    expect(checks).toBe(1);
  });

  it('rechecks focus when a window opened before the watch closes', () => {
    const { source } = fakeApp();
    let checks = 0;
    const window = new EventEmitter();
    watchSparkFocus(source, [window], () => (checks += 1));
    window.emit('closed');
    expect(checks).toBe(1);
  });

  it('stops listening once stopped', () => {
    const { emitter, source } = fakeApp();
    let checks = 0;
    const stop = watchSparkFocus(source, [], () => (checks += 1));
    stop();
    for (const name of ['browser-window-focus', 'browser-window-blur', 'did-become-active']) {
      emitter.emit(name);
    }
    emitter.emit('did-resign-active');
    expect(checks).toBe(0);
    expect(emitter.listenerCount('browser-window-created')).toBe(0);
  });
});
