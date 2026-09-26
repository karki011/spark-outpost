export function markScrollbarStyle(): void {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;top:-200px;width:100px;height:100px;overflow:scroll';
  document.body.append(probe);
  const classic = probe.offsetWidth - probe.clientWidth > 0;
  probe.remove();
  document.documentElement.dataset.scrollbars = classic ? 'classic' : 'overlay';
}
