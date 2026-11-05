const SCROLL_IDLE_MS = 900;

export function markScrollbarStyle(): void {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;top:-200px;width:100px;height:100px;overflow:scroll';
  document.body.append(probe);
  const classic = probe.offsetWidth - probe.clientWidth > 0;
  probe.remove();
  document.documentElement.dataset.scrollbars = classic ? 'classic' : 'overlay';
  if (!classic) trackScrolling();
}

function trackScrolling(): void {
  const timers = new WeakMap<Element, number>();
  document.addEventListener(
    'scroll',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      target.setAttribute('data-scrolling', '');
      window.clearTimeout(timers.get(target));
      timers.set(
        target,
        window.setTimeout(() => target.removeAttribute('data-scrolling'), SCROLL_IDLE_MS),
      );
    },
    { capture: true, passive: true },
  );
}
