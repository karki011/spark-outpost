const NAVIGATION_KEYS = new Set([
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Escape',
]);

function mark(modality: 'keyboard' | 'pointer') {
  if (document.documentElement.dataset.input !== modality) {
    document.documentElement.dataset.input = modality;
  }
}

export function trackInputModality(): void {
  mark('pointer');
  window.addEventListener(
    'keydown',
    (event) => {
      if (NAVIGATION_KEYS.has(event.key)) mark('keyboard');
    },
    true,
  );
  window.addEventListener('pointerdown', () => mark('pointer'), true);
}
