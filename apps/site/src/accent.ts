interface SiteAccent {
  choose(accent: string): void;
  current(): string;
}

declare global {
  interface Window {
    sparkAccent?: SiteAccent;
  }
}

function labelOf(input: HTMLInputElement): string {
  return input.closest('label')?.textContent?.trim() ?? '';
}

export function setUpAccentPicker(): void {
  const picker = document.querySelector<HTMLElement>('[data-accent-picker]');
  const name = picker?.querySelector<HTMLElement>('[data-accent-name]');
  const accent = window.sparkAccent;
  if (!picker || !name || !accent) return;
  const inputs = [...picker.querySelectorAll<HTMLInputElement>('input[name="accent"]')];

  const sync = () => {
    const current = accent.current();
    for (const input of inputs) {
      input.checked = input.value === current;
      if (input.checked) name.textContent = labelOf(input);
    }
  };

  picker.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    accent.choose(input.value);
    sync();
  });
  sync();
}

export function onPaletteChange(change: () => void): void {
  new MutationObserver(change).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-accent', 'data-skin'],
  });
}
