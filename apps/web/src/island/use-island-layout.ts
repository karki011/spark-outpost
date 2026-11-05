import { useEffect, useRef } from 'react';

export function useIslandLayout(measure: () => void, trigger: string): () => void {
  const latest = useRef(measure);
  const schedule = useRef<() => void>(() => undefined);
  useEffect(() => {
    latest.current = measure;
  });

  useEffect(() => {
    let frame = 0;
    const run = () => {
      frame = 0;
      latest.current();
    };
    schedule.current = () => {
      if (!frame) frame = requestAnimationFrame(run);
    };
    const changed = () => schedule.current();
    const mutations = new MutationObserver(changed);
    mutations.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    window.addEventListener('resize', changed);
    document.addEventListener('animationend', changed, true);
    document.addEventListener('transitionend', changed, true);
    changed();
    return () => {
      cancelAnimationFrame(frame);
      schedule.current = () => undefined;
      mutations.disconnect();
      window.removeEventListener('resize', changed);
      document.removeEventListener('animationend', changed, true);
      document.removeEventListener('transitionend', changed, true);
    };
  }, []);

  useEffect(() => {
    schedule.current();
  }, [trigger]);

  return () => schedule.current();
}
