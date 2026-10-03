const ITERATION_EVENT = 'animationiteration';

type Listen = EventTarget['addEventListener'];

export function ignoreAnimationIterationListeners(target: { addEventListener: Listen }): void {
  const listen = target.addEventListener;
  const listenExceptIterations: Listen = function (this: EventTarget, type, listener, options) {
    if (type === ITERATION_EVENT) return;
    listen.call(this, type, listener, options);
  };
  target.addEventListener = listenExceptIterations;
}
